import type { Entity } from "../entity/Entity";
import type { Game } from "../Game";
import type { Body } from "../physics/body/Body";
import { AABB } from "../physics/collision/AABB";
import { Capsule } from "../physics/shapes/Capsule";
import { Convex } from "../physics/shapes/Convex";
import { Line } from "../physics/shapes/Line";
import { Shape } from "../physics/shapes/Shape";
import { V, V2d } from "../Vector";

/**
 * Entities with this tag cast shadows from lights: every shape with corners
 * (boxes, polygons, capsules, lines) of their `body` and `bodies`. Static
 * ones are kept on the GPU; moving ones (doors) cost more (see
 * `ShadowCasters`).
 */
export const CAST_SHADOW_TAG = "cast_shadow";

/** An entity's bodies: its `body` and its `bodies` */
export function getEntityBodies(entity: Entity): readonly Body[] {
  if (!entity.bodies) {
    return entity.body ? [entity.body] : [];
  }
  return entity.body ? [entity.body, ...entity.bodies] : entity.bodies;
}

/**
 * The bodies within `radius` of `center` that cast shadows, static ones and,
 * with `includeMoving`, moving ones too
 */
export function getShadowCasters(
  game: Game,
  center: V2d,
  radius: number,
  includeMoving: boolean,
): Body[] {
  const world = game.world;
  const aabb = new AABB({
    lowerBound: center.sub([radius, radius]),
    upperBound: center.add([radius, radius]),
  });
  const result: Body[] = [];

  // Static casters (walls) come from the broadphase's static hash. Only a
  // handful of moving bodies (doors) usually cast shadows, so they're found
  // by tag below rather than by sifting through every moving body nearby.
  for (const body of world.broadphase?.aabbQuery(world, aabb, false) ?? []) {
    if (
      body.motion === "static" &&
      body.owner?.tags?.includes(CAST_SHADOW_TAG)
    ) {
      result.push(body);
    }
  }

  if (includeMoving) {
    for (const entity of game.entities.getTagged(CAST_SHADOW_TAG)) {
      for (const body of getEntityBodies(entity)) {
        if (body.motion !== "static" && body.getAABB().overlaps(aabb)) {
          result.push(body);
        }
      }
    }
  }

  return result;
}

/**
 * Returns the "corners" of a shape in world coordinates, for casting shadows.
 * Shapes without corners (circles, particles, planes) don't cast shadows.
 */
export function getShapeCorners(shape: Shape, body: Body): V2d[] {
  if (shape instanceof Convex) {
    // This includes boxes
    return shape.vertices.map((vertex) =>
      shapePointToWorld(vertex, shape, body),
    );
  } else if (shape instanceof Capsule) {
    const { length, radius } = shape;
    return [
      V(length / 2, -radius),
      V(length / 2, radius),
      V(-length / 2, radius),
      V(-length / 2, -radius),
    ].map((point) => shapePointToWorld(point, shape, body));
  } else if (shape instanceof Line) {
    return [V(-shape.length / 2, 0), V(shape.length / 2, 0)].map((point) =>
      shapePointToWorld(point, shape, body),
    );
  }
  return [];
}

function shapePointToWorld(point: V2d, shape: Shape, body: Body): V2d {
  return body.toWorldFrame(point.toGlobalFrame(shape.position, shape.angle));
}
