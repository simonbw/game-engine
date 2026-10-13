import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import { BaseEntity } from "../entity/BaseEntity";
import { Entity } from "../entity/Entity";
import { on } from "../entity/handler";
import type { AtlasPage, AtlasSlot } from "./LightAtlas";

export interface LightOptions {
  /**
   * What the light looks like: any display object, centered on the light,
   * in meters. Its brightness and color are applied on top.
   */
  sprite?: Container;
  /** Width and height of the square around the light that it lights, in meters */
  size?: number;
  /** Whether walls (`CAST_SHADOW_TAG`) cast shadows from it */
  shadowsEnabled?: boolean;
  /** Radius of the light source in meters; bigger means softer shadows, 0 means hard */
  sourceRadius?: number;
  /** Drawn again every frame, for a light that changes all the time (see `Light`) */
  dynamic?: boolean;
  position?: [number, number];
  intensity?: number;
  color?: number;
}

/**
 * A light. The `LightingManager` draws the lights in view all together: each
 * gets a square of `size` meters in a light atlas, where its `lightSprite` is
 * drawn and then the shadowed part erased with its square of the shadow mask
 * atlas (if it casts shadows), and every frame that square is added onto the
 * screen with the light's brightness and color. Without a `LightingManager`
 * in the game, lights aren't drawn and cost nothing.
 *
 * A light is static or `dynamic`. A dynamic one is drawn again every frame,
 * for lights that change all the time (fire, things that move). A static one
 * keeps its square, and is only drawn again when something that shows in it
 * changes: its setters mark it `dirty` (position, size, source radius,
 * shadows on or off), and so do new walls. Brightness and color don't, since
 * they're applied as it's added onto the screen, so a static light can
 * flicker for free. Anything else that changes how it looks (its
 * `lightSprite`, from outside) has to call `invalidate()`. A static light
 * that changes every frame still looks right; it just costs what a dynamic
 * one does.
 */
export class Light extends BaseEntity implements Entity {
  /** What the light looks like, centered on it */
  readonly lightSprite: Container;
  /** Adds the light's square of the light atlas onto the screen */
  readonly compositeSprite: Sprite;
  /** Erases the shadowed part of the light in the light atlas */
  readonly maskSprite: Sprite;
  /** Holds `lightSprite` where the light's square of the light atlas is */
  readonly container = new Container();
  /** Disabled lights aren't drawn */
  enabled: boolean = true;
  /** Drawn again every frame, rather than when it changes (see above) */
  dynamic: boolean;
  /** Whether a static light has changed since it was last drawn */
  dirty: boolean = true;
  /** Width and height of the square around the light that it lights, in meters */
  size: number;
  shadowsEnabled: boolean;
  /** Radius of the light source in meters; bigger means softer shadows, 0 means hard */
  sourceRadius: number;
  /** Where the light is in the atlas this frame, if it's in view */
  slot?: AtlasSlot;
  private slotPage?: AtlasPage;
  /** The static atlas keeping a square for it, told when it's gone */
  keptBy?: { forget(light: Light): void };

  constructor({
    sprite = new Container(),
    size = 2,
    shadowsEnabled = false,
    sourceRadius = 0,
    dynamic = false,
    position,
    intensity = 1,
    color = 0xffffff,
  }: LightOptions = {}) {
    super();
    this.lightSprite = sprite;
    this.size = size;
    this.shadowsEnabled = shadowsEnabled;
    this.sourceRadius = sourceRadius;
    this.dynamic = dynamic;
    this.container.addChild(sprite);

    this.compositeSprite = new Sprite(new Texture({ frame: new Rectangle() }));
    this.compositeSprite.anchor.set(0.5, 0.5);
    this.compositeSprite.blendMode = "add";
    this.maskSprite = new Sprite(new Texture({ frame: new Rectangle() }));
    this.maskSprite.anchor.set(0.5, 0.5);
    // Erases the blocked fraction of the light
    this.maskSprite.blendMode = "erase";

    this.setIntensity(intensity);
    this.setColor(color);
    if (position) {
      this.setPosition(position);
    }
  }

  @on("destroy")
  onDestroy() {
    this.keptBy?.forget(this);
    this.keptBy = undefined;
    // These aren't registered with the renderer as entity sprites, so nothing
    // else cleans them up
    this.compositeSprite.destroy({ texture: true });
    this.maskSprite.destroy({ texture: true });
    this.container.destroy({ children: true });
  }

  /** Where the light is, in world coordinates */
  get x(): number {
    return this.compositeSprite.position.x;
  }
  get y(): number {
    return this.compositeSprite.position.y;
  }

  /** Something about how it looks changed that its setters don't know about */
  invalidate() {
    this.dirty = true;
  }

  /** Set the width and height of the square it lights, in meters. */
  setSize(size: number) {
    if (size !== this.size) {
      this.size = size;
      this.dirty = true;
    }
  }

  /** Whether there's anything to draw: enabled and not at zero brightness */
  get isLit(): boolean {
    return this.enabled && this.compositeSprite.alpha > 0;
  }

  /**
   * Puts the light's sprites where its slot in the atlas is: the light drawn
   * in the middle of it, the mask and the composite reading from it
   */
  placeInAtlas(slot: AtlasSlot, page: AtlasPage) {
    const old = this.slot;
    if (
      old &&
      this.slotPage === page &&
      old.x === slot.x &&
      old.y === slot.y &&
      this.compositeSprite.texture.frame.width === this.size
    ) {
      return;
    }
    this.slot = slot;
    this.slotPage = page;
    this.container.position.set(slot.x, slot.y);
    this.maskSprite.position.set(slot.x, slot.y);
    viewSlot(this.maskSprite, page.mask.source, slot, this.size);
    viewSlot(this.compositeSprite, page.light.source, slot, this.size);
  }

  enableShadows() {
    if (!this.shadowsEnabled) {
      this.shadowsEnabled = true;
      this.dirty = true;
    }
  }

  disableShadows() {
    if (this.shadowsEnabled) {
      this.shadowsEnabled = false;
      this.dirty = true;
    }
  }

  setPosition([x, y]: readonly [number, number] | readonly number[]) {
    const position = this.compositeSprite.position;
    if (x !== position.x || y !== position.y) {
      position.set(x, y);
      this.dirty = true;
    }
  }

  /** How bright the light is (free to change: it doesn't make the light dirty) */
  setIntensity(value: number) {
    this.compositeSprite.alpha = value;
  }

  /** The light's color (free to change: it doesn't make the light dirty) */
  setColor(value: number) {
    this.compositeSprite.tint = value;
  }

  setSourceRadius(value: number) {
    if (value !== this.sourceRadius) {
      this.sourceRadius = value;
      this.dirty = true;
    }
  }
}

/** Whether an entity is a light, for the `LightingManager`'s filter */
export function isLight(entity: Entity): entity is Light {
  return entity instanceof Light;
}

/** Points `sprite`'s texture at the square of `size` meters in the middle of `slot` */
function viewSlot(
  sprite: Sprite,
  source: Texture["source"],
  slot: AtlasSlot,
  size: number,
) {
  const texture = sprite.texture;
  if (texture.source !== source) {
    texture.source = source;
  }
  const half = size / 2;
  texture.frame.x = slot.x - half;
  texture.frame.y = slot.y - half;
  texture.frame.width = texture.orig.width = size;
  texture.frame.height = texture.orig.height = size;
  texture.update();
}
