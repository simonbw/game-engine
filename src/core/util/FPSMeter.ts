import { Container, Text } from "pixi.js";
import { LayerName } from "../../config/layers";
import Game from "../Game";
import BaseEntity from "../entity/BaseEntity";
import Entity from "../entity/Entity";
import { GameSprite } from "../entity/GameSprite";
import SpatialHashingBroadphase from "../physics/SpatialHashingBroadphase";

const SMOOTHING = 0.95;
export default class FPSMeter extends BaseEntity implements Entity {
  persistenceLevel = 100;
  lastUpdate: number;
  averageDuration: number = 0;
  slowFrameCount: number = 0;
  sprite: Text & GameSprite;

  constructor(layerName?: LayerName) {
    super();
    this.lastUpdate = performance.now();
    this.sprite = new Text({
      text: "",
      style: {
        fontSize: 12,
        fill: "white",
        align: "left",
        dropShadow: {
          color: 0x000000,
          alpha: 0.5,
          angle: 0,
          distance: 0,
          blur: 2,
        },
      },
    });
    this.sprite.layerName = layerName;
  }

  onAdd() {
    this.averageDuration = 1 / 60;
  }

  onRender() {
    const now = performance.now();
    const duration = now - this.lastUpdate;
    this.averageDuration =
      SMOOTHING * this.averageDuration + (1.0 - SMOOTHING) * duration;
    this.lastUpdate = now;

    this.sprite.text = this.getText();
  }

  getStats() {
    const world = this.game?.world;
    const broadphase = this.game?.world.broadphase as SpatialHashingBroadphase;
    return {
      fps: Math.ceil(1000 / this.averageDuration),
      fps2: this.game!.getScreenFps(),
      bodyCount: world?.bodies.length ?? 0,
      hugeBodyCount: broadphase.hugeBodies?.size ?? 0,
      dynamicBodyCount: broadphase.dynamicBodies.size,
      kinematicBodyCount: broadphase.kinematicBodies.size,
      particleBodyCount: broadphase.particleBodies.size,
      entityCount: this.game?.entities.all.size ?? 0,
      spriteCount: getSpriteCount(this.game!.renderer.stage),
      collisions: (this.game?.world.broadphase as SpatialHashingBroadphase)
        .debugData.numCollisions,
    };
  }

  getText() {
    const {
      fps,
      fps2,
      bodyCount,
      hugeBodyCount,
      kinematicBodyCount,
      particleBodyCount,
      dynamicBodyCount,
      collisions,
      entityCount,
      spriteCount,
    } = this.getStats();
    return `fps: ${fps} (${fps2}) | bodies: ${bodyCount} (${kinematicBodyCount}, ${particleBodyCount}, ${dynamicBodyCount}, ${hugeBodyCount}) | collisions: ${collisions} | entities: ${entityCount} | sprites ${spriteCount}`;
  }
}

/** Counts the number of children of a display object. */
function getSpriteCount(root: Container): number {
  let total = 1;

  for (const child of root.children ?? []) {
    total += getSpriteCount(child);
  }

  return total;
}
