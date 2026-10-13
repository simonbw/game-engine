import { Sprite, Texture } from "pixi.js";
import { Light, LightOptions } from "./Light";

export interface PointLightOptions extends Omit<
  LightOptions,
  "sprite" | "size"
> {
  /** How far the light reaches, in meters */
  radius?: number;
  /** Soft shadows with a source radius proportional to the light's radius */
  softShadows?: boolean;
  /**
   * What the light looks like, stretched over its whole radius: white where
   * it's brightest, black (or transparent) where it's out, drawn additively.
   * By default a falloff drawn in code (`getPointLightTexture`).
   */
  texture?: Texture;
}

/** Source radius as a fraction of the light radius, when softShadows is set */
const SOFTNESS = 0.08;

/** A round light, brightest in the middle. Casts shadows by default. */
export class PointLight extends Light {
  constructor({
    radius = 1,
    shadowsEnabled = true,
    softShadows = false,
    sourceRadius = softShadows ? radius * SOFTNESS : 0,
    texture = getPointLightTexture(),
    ...rest
  }: PointLightOptions = {}) {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.5);
    sprite.blendMode = "add";
    super({ ...rest, sprite, shadowsEnabled, sourceRadius });
    this.setRadius(radius);
  }

  setRadius(radius: number) {
    this.invalidate();
    this.lightSprite.width = radius * 2;
    this.lightSprite.height = radius * 2;
    this.setSize(radius * 2);
  }
}

/** Pixels across the default point light texture */
const TEXTURE_PIXELS = 256;
let pointLightTexture: Texture | undefined;

/**
 * The default look of a point light: white, falling off with distance like
 * light does (inverse square, sort of) and reaching black at the edge
 */
export function getPointLightTexture(): Texture {
  if (!pointLightTexture) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = TEXTURE_PIXELS;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(TEXTURE_PIXELS, TEXTURE_PIXELS);
    const half = TEXTURE_PIXELS / 2;
    for (let y = 0; y < TEXTURE_PIXELS; y++) {
      for (let x = 0; x < TEXTURE_PIXELS; x++) {
        const d = Math.min(
          1,
          Math.hypot(x + 0.5 - half, y + 0.5 - half) / half,
        );
        const window = 1 - d * d;
        const brightness = Math.round(
          ((window * window) / (1 + 10 * d * d)) * 255,
        );
        const i = (y * TEXTURE_PIXELS + x) * 4;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = brightness;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    pointLightTexture = Texture.from(canvas);
    pointLightTexture.source.scaleMode = "linear";
  }
  return pointLightTexture;
}
