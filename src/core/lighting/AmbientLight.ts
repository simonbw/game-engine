import { BaseEntity } from "../entity/BaseEntity";
import { Entity } from "../entity/Entity";
import { hexToRgb, RGB } from "../util/ColorUtils";

/**
 * Light everywhere, shadows or not. The `LightingManager` adds up the colors
 * of all the ambient lights in the game, and that's what's left where no
 * other light reaches. With none, unlit places are black.
 */
export class AmbientLight extends BaseEntity implements Entity {
  color: RGB;

  constructor(color: number) {
    super();
    this.color = hexToRgb(color);
  }

  setColor(color: number) {
    this.color = hexToRgb(color);
  }
}

/** Whether an entity is an ambient light, for the `LightingManager`'s filter */
export function isAmbientLight(entity: Entity): entity is AmbientLight {
  return entity instanceof AmbientLight;
}
