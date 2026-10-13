import { Container, RenderTexture, Sprite, Texture } from "pixi.js";
import { LayerName, LAYERS } from "../../config/layers";
import { BaseEntity } from "../entity/BaseEntity";
import { Entity } from "../entity/Entity";
import { GameSprite } from "../entity/GameSprite";
import { on } from "../entity/handler";
import { Game } from "../Game";
import { hexToRgb, rgbToHex } from "../util/ColorUtils";
import { measureCpuAndGpu } from "../util/GpuProfiler";
import { clamp, lerp } from "../util/MathUtil";
import { profiler } from "../util/Profiler";
import { V, V2d } from "../Vector";
import { isAmbientLight } from "./AmbientLight";
import { isLight, Light } from "./Light";
import { AtlasPage, LightAtlas, StaticLightAtlas } from "./LightAtlas";
import { Area, ShadowCasters } from "./ShadowCasters";

export interface LightingManagerOptions {
  /**
   * The layer the lighting goes in. Everything in the layers below it is lit;
   * anything that glows on its own goes in a layer above it. It must not move
   * with the camera (`parallax: V(0, 0)`), since the lighting is drawn in
   * screen coordinates.
   */
  layer: LayerName;
  /** Pixels per meter of the lights and their shadows (default 32); see `setResolution` */
  resolution?: number;
  /** Whether dynamic lights cast shadows (default true); see `dynamicShadows` */
  dynamicShadows?: boolean;
  /** For keeping it through `game.clearScene()` */
  persistenceLevel?: number;
}

/**
 * Lights the world: a screen-sized texture, cleared to the ambient color with
 * every light in view added onto it, multiplied over everything below the
 * lighting layer. Add one to the game to turn lighting on; lights
 * (`PointLight`, `DirectionalLight`, `AmbientLight`) can come and go before
 * or after it.
 *
 * Lights are drawn into squares of a light atlas, in a few render passes
 * however many there are: for each page, one draw call puts every light's
 * shadows in the mask page (`ShadowCasters`, with the walls kept on the GPU),
 * and one pass draws the lights into the light page and erases what their
 * masks cover. Dynamic lights are packed into `LightAtlas` pages and drawn
 * every frame; static ones keep their squares in the `StaticLightAtlas` and
 * are only drawn when they change (see `Light`). Then one more pass adds
 * every light in view onto the screen, with its brightness and color.
 *
 * Needs Pixi's WebGL renderer (WebGL2), which is the default.
 */
export class LightingManager extends BaseEntity implements Entity {
  texture!: RenderTexture;
  sprite!: Sprite & GameSprite;
  lightContainer = new Container();

  /** The color unlit places are: the ambient lights added up, and blended (see `setAmbientBlend`) */
  ambientColor = 0;
  /** Blended over the ambient lights' color (see `setAmbientBlend`) */
  private ambientBlend = { color: { r: 0, g: 0, b: 0 }, amount: 0 };
  /** The walls, on the GPU, that lights' shadow masks are drawn from */
  readonly shadowCasters = new ShadowCasters();
  /** Pixels per meter of the lights and their shadows */
  private resolution: number;
  /** Squares for the dynamic lights, every frame */
  private atlas: LightAtlas;
  /** Squares for the static lights, kept */
  private staticAtlas: StaticLightAtlas;
  /** What gets drawn into a page of an atlas */
  private atlasContainer = new Container();
  /** Erase squares for clearing lights' squares (see `addClearSquares`) */
  private clearSquares: Sprite[] = [];
  /** The lights in view this frame, all of them, static and dynamic (kept to save making new arrays) */
  private inView: Light[] = [];
  private staticInView: Light[] = [];
  private dynamicInView: Light[] = [];
  private layer: LayerName;

  /**
   * Whether dynamic lights cast shadows. They're drawn every frame, shadows
   * and all, so turning this off saves the most on slow GPUs.
   */
  dynamicShadows: boolean;

  private _enabled = true;
  /** When disabled, the world is drawn unlit (for debugging and benchmarks). */
  get enabled() {
    return this._enabled;
  }
  set enabled(value: boolean) {
    this._enabled = value;
    if (this.sprite) {
      this.sprite.visible = value;
    }
  }

  constructor({
    layer,
    resolution = 32,
    dynamicShadows = true,
    persistenceLevel = 0,
  }: LightingManagerOptions) {
    super();
    this.layer = layer;
    this.resolution = resolution;
    this.dynamicShadows = dynamicShadows;
    this.persistenceLevel = persistenceLevel;
    this.atlas = new LightAtlas(resolution);
    this.staticAtlas = new StaticLightAtlas(resolution);

    const [parallaxX, parallaxY] = LAYERS[layer].parallax;
    if (parallaxX !== 0 || parallaxY !== 0) {
      console.warn(
        `LightingManager: layer "${layer}" moves with the camera, so the ` +
          `lighting will be drawn in the wrong place. Give it parallax V(0, 0).`,
      );
    }
  }

  private get renderer() {
    return this.game.renderer.app.renderer;
  }

  /** The lights in the game */
  get lights(): Iterable<Light> {
    return this.game.entities.getByFilter(isLight);
  }

  @on("add")
  onAdd({ game }: { game: Game }) {
    const gl = (game.renderer.app.renderer as { gl?: unknown }).gl;
    if (
      typeof WebGL2RenderingContext === "undefined" ||
      !(gl instanceof WebGL2RenderingContext)
    ) {
      throw new Error(
        "LightingManager needs Pixi's WebGL renderer, with WebGL2 (its shaders are GLSL ES 3.0)",
      );
    }
    // Live lists of the lights, whenever they were added
    game.entities.addFilter(isLight);
    game.entities.addFilter(isAmbientLight);

    const [width, height] = game.renderer.getSize();
    this.texture = RenderTexture.create({
      width,
      height,
      resolution: this.renderer.resolution,
    });

    this.sprite = new Sprite(this.texture);
    this.sprite.layerName = this.layer;
    this.sprite.blendMode = "multiply";
    this.sprite.anchor.set(0, 0);
    this.sprite.visible = this._enabled;
  }

  @on("resize")
  onResize({ size: [width, height] }: { size: V2d }) {
    // The renderer's resolution can change too, and this texture has to
    // match or the lighting is drawn at the wrong scale
    this.texture.resize(width, height, this.renderer.resolution);
  }

  @on("destroy")
  onDestroy({ game }: { game: Game }) {
    game.entities.removeFilter(isLight);
    game.entities.removeFilter(isAmbientLight);
    this.shadowCasters.destroy();
    this.atlas.destroy();
    this.staticAtlas.destroy();
    this.texture.destroy(true);
    for (const square of this.clearSquares) {
      square.destroy();
    }
  }

  /**
   * Draws lights at `pixelsPerMeter` from now on: starts both atlases over at
   * that size, and every light is drawn again. Lower is cheaper and blurrier.
   */
  setResolution(pixelsPerMeter: number) {
    if (pixelsPerMeter === this.resolution) {
      return;
    }
    this.resolution = pixelsPerMeter;
    this.atlas.destroy();
    this.atlas = new LightAtlas(pixelsPerMeter);
    this.staticAtlas.destroy();
    this.staticAtlas = new StaticLightAtlas(pixelsPerMeter);
    if (this.isAdded) {
      for (const light of this.lights) {
        light.dirty = true;
      }
    }
  }

  /**
   * Blends the ambient lights' color `amount` (0 to 1) of the way to
   * `color`, whatever they are: for fading the darkness to something else
   */
  setAmbientBlend(color: number, amount: number) {
    this.ambientBlend = { color: hexToRgb(color), amount };
  }

  /** The ambient lights added up, then blended (see `setAmbientBlend`) */
  private updateAmbientColor() {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const light of this.game.entities.getByFilter(isAmbientLight)) {
      r += light.color.r;
      g += light.color.g;
      b += light.color.b;
    }
    const { color, amount } = this.ambientBlend;
    r = lerp(clamp(r, 0, 255), color.r, amount);
    g = lerp(clamp(g, 0, 255), color.g, amount);
    b = lerp(clamp(b, 0, 255), color.b, amount);
    this.ambientColor = rgbToHex({
      r: Math.round(r),
      g: Math.round(g),
      b: Math.round(b),
    });
  }

  // Decide whether or not to render a light
  private shouldRenderLight(
    light: Light,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ) {
    const halfSize = light.size / 2;
    return (
      light.isLit &&
      light.x - halfSize < maxX &&
      light.x + halfSize > minX &&
      light.y - halfSize < maxY &&
      light.y + halfSize > minY
    );
  }

  // Late render, so everything has rendered and put its lights where they go
  @on("lateRender")
  onLateRender() {
    if (!this.enabled) {
      return;
    }
    this.updateAmbientColor();
    const camera = this.game.camera;
    this.lightContainer.setFromMatrix(camera.getMatrix());

    const [minX, minY] = camera.toWorld(V(0, 0));
    const [maxX, maxY] = camera.toWorld(camera.getViewportSize());

    // New walls (a new level) mean new meshes of them, and new shadows for
    // the static lights near them
    for (const area of this.shadowCasters.update(this.game)) {
      this.staticAtlas.invalidateArea(area);
    }

    const inView = this.inView;
    const staticInView = this.staticInView;
    const dynamicInView = this.dynamicInView;
    inView.length = staticInView.length = dynamicInView.length = 0;
    // The area the squares of the lights in view cover
    const region: Area = [Infinity, Infinity, -Infinity, -Infinity];
    for (const light of this.lights) {
      if (this.shouldRenderLight(light, minX, minY, maxX, maxY)) {
        inView.push(light);
        (light.dynamic ? dynamicInView : staticInView).push(light);
        const halfSize = light.size / 2;
        region[0] = Math.min(region[0], light.x - halfSize);
        region[1] = Math.min(region[1], light.y - halfSize);
        region[2] = Math.max(region[2], light.x + halfSize);
        region[3] = Math.max(region[3], light.y + halfSize);
      }
    }

    // Moving casters (doors): the ones the lights reach, and static lights
    // drawn again where one moved
    profiler.measure("LightingManager.moving", () => {
      for (const area of this.shadowCasters.updateMoving(
        inView.length > 0 ? region : undefined,
      )) {
        this.staticAtlas.invalidateArea(area);
      }
    });

    // The static lights that changed, in their squares of the static page
    if (staticInView.length > 0) {
      const changed = profiler.measure("LightingManager.packStatic", () =>
        this.staticAtlas.update(staticInView, this.game.framenumber),
      );
      if (changed.length > 0) {
        measureCpuAndGpu("LightingManager.static", () => {
          this.drawLights(
            changed,
            this.staticAtlas.page!,
            this.staticAtlas.needsClear,
          );
        });
        this.staticAtlas.needsClear = false;
        for (const light of changed) {
          light.dirty = false;
        }
      }
    }

    // Every dynamic light, on pages of their own
    if (dynamicInView.length > 0) {
      const pages = profiler.measure("LightingManager.pack", () =>
        this.atlas.pack(dynamicInView),
      );
      measureCpuAndGpu("LightingManager.dynamic", () => {
        for (let i = 0; i < pages.length; i++) {
          this.drawLights(pages[i], this.atlas.pages[i], true);
        }
      });
    }

    for (const light of inView) {
      this.lightContainer.addChild(light.compositeSprite);
    }

    // Then add them all onto the ambient light
    measureCpuAndGpu("LightingManager.composite", () => {
      this.renderer.render({
        container: this.lightContainer,
        target: this.texture,
        clear: true,
        clearColor: this.ambientColor,
      });
      this.flush();
    });
    this.lightContainer.removeChildren();
  }

  /**
   * Sends what's been drawn so far to the GPU. Without this the GPU only
   * starts on the lighting once the rest of the frame is drawn, and the
   * stage's sprite batches have to wait for it to finish with the buffers
   * they share (with 32 fires in view in Highrise, 85 fps instead of 110).
   */
  private flush() {
    const gl = (this.renderer as { gl?: WebGL2RenderingContext }).gl;
    gl?.flush();
  }

  /**
   * Draws the masks, then the lights, of `lights` into their squares of
   * `page`. With `clearPage` the whole page is cleared first; without it the
   * rest of the page is kept, and only the lights' own squares are cleared.
   */
  private drawLights(
    lights: readonly Light[],
    page: AtlasPage,
    clearPage: boolean,
  ) {
    const shadowed = lights.filter(
      (light) =>
        light.shadowsEnabled && (this.dynamicShadows || !light.dynamic),
    );
    const casters = this.shadowCasters;
    const drawMasks = shadowed.length > 0 && !casters.isEmpty;
    const container = this.atlasContainer;
    if (drawMasks) {
      measureCpuAndGpu("LightingManager.masks", () => {
        if (!clearPage) {
          // Masks add up, so their squares have to be clear first
          this.addClearSquares(container, shadowed);
          this.renderer.render({ container, target: page.mask, clear: false });
          container.removeChildren();
        }
        casters.draw(
          this.renderer,
          shadowed,
          page.mask,
          clearPage,
          this.resolution,
        );
      });
    }

    measureCpuAndGpu("LightingManager.lights", () => {
      if (!clearPage) {
        this.addClearSquares(container, lights);
      }
      for (const light of lights) {
        container.addChild(light.container);
      }
      if (drawMasks) {
        // After all the lights: the squares don't overlap, so this erases
        // each one's shadows from it alone, and they can all be one draw call
        for (const light of shadowed) {
          container.addChild(light.maskSprite);
        }
      }
      this.renderer.render({
        container,
        target: page.light,
        clear: clearPage,
        clearColor: [0, 0, 0, 0],
      });
      container.removeChildren();
      this.flush();
    });
  }

  /**
   * Adds a square to `container` over each light's square in the atlas
   * (padding and all) that erases whatever's there: Pixi can't clear part of
   * a texture, but an opaque white square in the "erase" blend mode leaves
   * nothing behind
   */
  private addClearSquares(container: Container, lights: readonly Light[]) {
    for (let i = 0; i < lights.length; i++) {
      let square = this.clearSquares[i];
      if (!square) {
        square = new Sprite(Texture.WHITE);
        square.anchor.set(0.5);
        square.blendMode = "erase";
        this.clearSquares.push(square);
      }
      const slot = lights[i].slot!;
      square.position.set(slot.x, slot.y);
      square.width = square.height = slot.side / this.resolution;
      container.addChild(square);
    }
  }
}
