import { Matrix, Point } from "pixi.js";
import { TickLayerName } from "../../config/tickLayers";
import { ReadonlyV2d, V, V2d } from "../Vector";
import { BaseEntity } from "../entity/BaseEntity";
import { Entity, GameEventMap } from "../entity/Entity";
import { on } from "../entity/handler";
import { lerpOrSnap } from "../util/MathUtil";
import { LayerInfo } from "./LayerInfo";

// Bounds for camera position/velocity validation
const MAX_CAMERA_POSITION = 1_000_000_000;
const MAX_CAMERA_VELOCITY = 1_000_000_000;
const MAX_CAMERA_ZOOM = 1_000_000;

/** World-space bounds of what the camera can see. */
export interface Viewport {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
  readonly height: number;
}

/** Anything that can report the size of the viewport in logical pixels. */
export interface ViewportProvider {
  getWidth(): number;
  getHeight(): number;
}

/**
 * Controls the viewport: where in the world we're looking, how zoomed in, and
 * how rotated. Ticks on the "camera" layer so it sees final positions.
 */
export class Camera2d extends BaseEntity implements Entity {
  tags = ["camera"];
  persistenceLevel = 100;
  tickLayer: TickLayerName = "camera";

  viewportProvider: ViewportProvider;
  private _position: V2d;
  private _z: number;
  private _angle: number;
  private _shakeOffset: V2d = V(0, 0);
  velocity: V2d;

  parallaxScale = 0.1;

  // Cache for getWorldViewport (set to null to invalidate)
  private _cachedViewport: Viewport | null = null;
  // Cache for viewport dimensions (to detect external resize)
  private _lastViewportWidth: number = 0;
  private _lastViewportHeight: number = 0;
  // Cache for getMatrix with default parallax [1,1] and anchor [0,0]
  private _cachedMatrix: Matrix | null = null;

  constructor(
    viewportProvider: ViewportProvider,
    position: V2d = V([0, 0]),
    z = 25.0,
    angle = 0,
  ) {
    super();
    this.viewportProvider = viewportProvider;
    this._position = position;
    this._z = z;
    this._angle = angle;
    this.velocity = V([0, 0]);
  }

  /** Check if a value is valid (finite and within bounds) */
  private isValidPosition(value: number): boolean {
    return isFinite(value) && Math.abs(value) <= MAX_CAMERA_POSITION;
  }

  private isValidVelocity(value: number): boolean {
    return isFinite(value) && Math.abs(value) <= MAX_CAMERA_VELOCITY;
  }

  private isValidZoom(value: number): boolean {
    return isFinite(value) && value > 0 && value <= MAX_CAMERA_ZOOM;
  }

  /** Invalidate caches (called when camera properties change) */
  private invalidateCache(): void {
    this._cachedViewport = null;
    this._cachedMatrix = null;
  }

  /** Read-only access to position. Use x/y setters or setPosition() to modify. */
  get position(): ReadonlyV2d {
    return this._position;
  }

  get x() {
    return this._position[0];
  }

  set x(value) {
    if (!this.isValidPosition(value)) {
      console.warn("Camera2d: Invalid x position rejected:", value);
      return;
    }
    this._position[0] = value;
    this.invalidateCache();
  }

  get y() {
    return this._position[1];
  }

  set y(value) {
    if (!this.isValidPosition(value)) {
      console.warn("Camera2d: Invalid y position rejected:", value);
      return;
    }
    this._position[1] = value;
    this.invalidateCache();
  }

  /** Zoom level. Bigger means more zoomed in. */
  get z() {
    return this._z;
  }

  set z(value) {
    if (!this.isValidZoom(value)) {
      console.warn("Camera2d: Invalid zoom rejected:", value);
      return;
    }
    this._z = value;
    this.invalidateCache();
  }

  get angle() {
    return this._angle;
  }

  set angle(value) {
    this._angle = value;
    this.invalidateCache();
  }

  /**
   * Where the camera is drawn from relative to its position, for screen
   * shake. Kept apart from `position` so whatever moves the camera doesn't
   * fight it. Set it with `setShakeOffset`.
   */
  get shakeOffset(): ReadonlyV2d {
    return this._shakeOffset;
  }

  /** Offset the view from the camera's position (for screen shake) */
  setShakeOffset(x: number, y: number): void {
    if (!this.isValidPosition(x) || !this.isValidPosition(y)) {
      console.warn("Camera2d.setShakeOffset: Invalid offset rejected:", x, y);
      return;
    }
    this._shakeOffset[0] = x;
    this._shakeOffset[1] = y;
    this.invalidateCache();
  }

  /** Set position directly (invalidates cache) */
  setPosition(x: number, y: number): void {
    if (!this.isValidPosition(x) || !this.isValidPosition(y)) {
      console.warn("Camera2d.setPosition: Invalid position rejected:", x, y);
      return;
    }
    this._position[0] = x;
    this._position[1] = y;
    this.invalidateCache();
  }

  get vx() {
    return this.velocity[0];
  }

  set vx(value) {
    if (!this.isValidVelocity(value)) {
      console.warn("Camera2d: Invalid vx velocity rejected:", value);
      return;
    }
    this.velocity[0] = value;
  }

  get vy() {
    return this.velocity[1];
  }

  set vy(value) {
    if (!this.isValidVelocity(value)) {
      console.warn("Camera2d: Invalid vy velocity rejected:", value);
      return;
    }
    this.velocity[1] = value;
  }

  getPosition(): V2d {
    return this._position;
  }

  @on("tick")
  onTick({ dt }: GameEventMap["tick"]) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  /** Center the camera on a position */
  center([x, y]: ReadonlyV2d) {
    this.setPosition(x, y);
  }

  /**
   * Move the camera toward being centered on a (possibly moving) target.
   * The camera matches the target's velocity and closes the remaining distance
   * exponentially, at `stiffness` per second. Call this from `onTick`.
   */
  smoothCenter(
    [x, y]: ReadonlyV2d,
    [vx, vy]: ReadonlyV2d = V([0, 0]),
    stiffness: number = 4.0,
  ) {
    if (!this.isValidPosition(x) || !this.isValidPosition(y)) {
      console.warn("Camera2d.smoothCenter: Invalid position rejected:", x, y);
      return;
    }
    if (!this.isValidVelocity(vx) || !this.isValidVelocity(vy)) {
      console.warn("Camera2d.smoothCenter: Invalid velocity rejected:", vx, vy);
      return;
    }

    // Closing more than the whole gap in one tick would overshoot
    const k = Math.min(stiffness, this.game.ticksPerSecond);
    this.vx = vx + k * (x - this.x);
    this.vy = vy + k * (y - this.y);
  }

  /**
   * Move the camera's velocity part of the way to `[vx, vy]`; `stiffness` is
   * the part of the way it goes per 60th of a second. Call this from `onTick`.
   */
  smoothSetVelocity([vx, vy]: ReadonlyV2d, stiffness: number = 0.9) {
    if (!this.isValidVelocity(vx) || !this.isValidVelocity(vy)) {
      console.warn(
        "Camera2d.smoothSetVelocity: Invalid velocity rejected:",
        vx,
        vy,
      );
      return;
    }
    const moved = 1 - perTick(1 - stiffness, this.game.tickDuration);
    this.vx = lerpOrSnap(this.vx, vx, moved, 0.001);
    this.vy = lerpOrSnap(this.vy, vy, moved, 0.001);
  }

  /**
   * Move the camera part of the way to the desired zoom; `smooth` is the
   * part of the way it doesn't go per 60th of a second. Call this from
   * `onTick`.
   */
  smoothZoom(z: number, smooth: number = 0.9) {
    if (!this.isValidZoom(z)) {
      console.warn("Camera2d.smoothZoom: Invalid zoom rejected:", z);
      return;
    }
    const kept = perTick(smooth, this.game.tickDuration);
    this.z = kept * this.z + (1 - kept) * z;
  }

  /** Returns [width, height] of the viewport in pixels */
  getViewportSize(): V2d {
    return V(
      this.viewportProvider.getWidth(),
      this.viewportProvider.getHeight(),
    );
  }

  /**
   * Calculates the world coordinate bounds of the current camera viewport.
   * Useful for culling, bounds checking, and viewport-relative positioning.
   * Results are cached and only recomputed when camera or viewport changes.
   */
  getWorldViewport(): Viewport {
    const viewportWidth = this.viewportProvider.getWidth();
    const viewportHeight = this.viewportProvider.getHeight();

    // Check if viewport dimensions changed (external resize)
    if (
      viewportWidth !== this._lastViewportWidth ||
      viewportHeight !== this._lastViewportHeight
    ) {
      this.invalidateCache();
      this._lastViewportWidth = viewportWidth;
      this._lastViewportHeight = viewportHeight;
    }

    // Return cached viewport if valid
    if (this._cachedViewport) {
      return this._cachedViewport;
    }

    // Transform all 4 screen corners to world space and compute AABB.
    // With camera rotation, opposite corners aren't sufficient.
    const w = viewportWidth;
    const h = viewportHeight;
    const c0 = this.toWorld(V(0, 0));
    const c1 = this.toWorld(V(w, 0));
    const c2 = this.toWorld(V(w, h));
    const c3 = this.toWorld(V(0, h));
    const left = Math.min(c0[0], c1[0], c2[0], c3[0]);
    const right = Math.max(c0[0], c1[0], c2[0], c3[0]);
    const top = Math.min(c0[1], c1[1], c2[1], c3[1]);
    const bottom = Math.max(c0[1], c1[1], c2[1], c3[1]);
    const width = right - left;
    const height = bottom - top;

    // Cache and return
    this._cachedViewport = { top, bottom, left, right, width, height };
    return this._cachedViewport;
  }

  /** Convert screen coordinates to world coordinates */
  toWorld([x, y]: ReadonlyV2d, parallax: ReadonlyV2d = V(1.0, 1.0)): V2d {
    let p = new Point(x, y);
    p = this.getMatrix(parallax).applyInverse(p, p);
    return V(p.x, p.y);
  }

  /** Convert world coordinates to screen coordinates */
  toScreen([x, y]: ReadonlyV2d, parallax: ReadonlyV2d = V(1.0, 1.0)): V2d {
    let p = new Point(x, y);
    p = this.getMatrix(parallax).apply(p, p);
    return V(p.x, p.y);
  }

  /** Creates a transformation matrix to go from world space to screen space. */
  getMatrix(
    /** Parallax factors for X and Y axes */
    parallax: ReadonlyV2d | readonly [number, number] = [1, 1],
    /** Anchor point for transformations */
    anchor: ReadonlyV2d | readonly [number, number] = [0, 0],
  ): Matrix {
    const px = parallax[0];
    const py = parallax[1];
    const ax = anchor[0];
    const ay = anchor[1];
    const [w, h] = this.getViewportSize();

    // Check if viewport dimensions changed (invalidates matrix cache)
    if (w !== this._lastViewportWidth || h !== this._lastViewportHeight) {
      this.invalidateCache();
      this._lastViewportWidth = w;
      this._lastViewportHeight = h;
    }

    // Use cached matrix for default case (parallax [1,1], anchor [0,0])
    const isDefaultCase = px === 1 && py === 1 && ax === 0 && ay === 0;
    if (isDefaultCase && this._cachedMatrix) {
      return this._cachedMatrix;
    }

    const { z, angle } = this;
    const cx = this.x + this._shakeOffset[0];
    const cy = this.y + this._shakeOffset[1];

    const matrix = new Matrix()
      // align the anchor with the camera
      .translate(ax * px, ay * py)
      .translate(-cx * px, -cy * py)
      // do all the scaling and rotating
      .scale(z * px, z * py)
      .rotate(angle)
      // put it back
      .translate(-ax * z, -ay * z)
      .scale(1 / px, 1 / py)
      // Put it on the center of the screen
      .translate(w / 2.0, h / 2.0);

    // Cache for default case
    if (isDefaultCase) {
      this._cachedMatrix = matrix;
    }

    return matrix;
  }

  /**
   * Check if a circle at (x, y) with given radius is visible in the viewport.
   * Uses cached viewport bounds - no allocations.
   * Useful for culling objects before rendering.
   */
  isVisible(x: number, y: number, radius: number): boolean {
    const v = this.getWorldViewport();
    return (
      x + radius >= v.left &&
      x - radius <= v.right &&
      y + radius >= v.top &&
      y - radius <= v.bottom
    );
  }

  /** Update the properties of a renderer layer to match this camera */
  updateLayer(layer: LayerInfo) {
    const container = layer.container;
    if (!layer.parallax.equals([0, 0])) {
      const matrix = this.getMatrix(layer.parallax, layer.anchor);
      container.updateTransform({
        x: matrix.tx,
        y: matrix.ty,
        scaleX: matrix.a,
        scaleY: matrix.d,
        skewX: matrix.b,
        skewY: matrix.c,
      });
    }
  }
}

export function viewportContains(
  viewport: Viewport,
  point: ReadonlyV2d,
): boolean {
  return (
    point[0] >= viewport.left &&
    point[0] <= viewport.right &&
    point[1] >= viewport.top &&
    point[1] <= viewport.bottom
  );
}

/** A fraction kept per 60th of a second, as the fraction kept per tick of `tickDuration` */
function perTick(keptPer60th: number, tickDuration: number): number {
  return Math.pow(keptPer60th, 60 * tickDuration);
}
