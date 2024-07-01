import { Container } from "pixi.js";
import { LayerName } from "../../config/layers";
import { WithOwner } from "./WithOwner";

/**
 * An extension of Pixi's Container class that lets us easily specify which layer a
 * sprite should be rendered in, as well as keep track of the entity that owns this sprite.
 */
export interface GameSprite extends Container, WithOwner {
  layerName?: LayerName;
}
