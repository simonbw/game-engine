import * as Pixi from "pixi.js";
import { V, V2d } from "../Vector";

/** Options for layer configuration */
export interface LayerInfoOptions {
  /** Parallax factor for camera movement. V(1,1) = moves with camera, V(0,0) = fixed on screen */
  parallax?: V2d;
  /** Anchor point for parallax transformations */
  anchor?: V2d;
  /** Pixi filters applied to the whole layer */
  filters?: Pixi.Filter[];
  /** Layer transparency (0-1) */
  alpha?: number;
}

/**
 * Configuration for a rendering layer.
 * Layers are rendered in order and can have different parallax settings.
 */
export class LayerInfo {
  /** The Pixi container that holds every sprite on this layer */
  readonly container: Pixi.Container;
  /** Parallax factor for this layer */
  parallax: V2d;
  /** Anchor point for parallax transformations */
  anchor: V2d;

  constructor({
    parallax = V(1.0, 1.0),
    anchor = V(0, 0),
    filters = [],
    alpha = 1.0,
  }: LayerInfoOptions = {}) {
    this.container = new Pixi.Container();
    this.parallax = parallax;
    this.anchor = anchor;
    this.container.filters = filters;
    this.container.alpha = alpha;
  }
}
