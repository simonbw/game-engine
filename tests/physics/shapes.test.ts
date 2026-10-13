// Shapes and helpers that tests/physics/physics.test.ts (from Highrise, which
// doesn't have them) doesn't cover: planes, boxes (Convex subclasses),
// concave decomposition with fromPolygon, and heightfields.
import assert from "node:assert/strict";
import { test } from "node:test";
import { V } from "../../src/core/Vector";
import type { Body } from "../../src/core/physics/body/Body";
import { createRigid2D } from "../../src/core/physics/body/bodyFactories";
import { Box } from "../../src/core/physics/shapes/Box";
import { Circle } from "../../src/core/physics/shapes/Circle";
import { Heightfield } from "../../src/core/physics/shapes/Heightfield";
import { Plane } from "../../src/core/physics/shapes/Plane";
import { fromPolygon } from "../../src/core/physics/utils/fromPolygon";
import { World } from "../../src/core/physics/world/World";

/** Like Jest's toBeCloseTo: equal to `digits` decimal places */
function assertClose(
  actual: number | undefined,
  expected: number,
  digits: number,
) {
  const tolerance = 10 ** -digits / 2;
  assert.ok(
    actual !== undefined && Math.abs(actual - expected) < tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

/** Matches Game's default tick rate. */
const DT = 1 / 120;
const GRAVITY = -10;

/**
 * Physics has no built-in gravity; apply it per body so tests can opt in.
 */
function run(world: World, seconds: number, gravityBodies: Body[] = []) {
  for (let i = 0; i < seconds / DT; i++) {
    for (const body of gravityBodies) {
      body.applyForce(V(0, GRAVITY * body.mass));
    }
    world.step(DT);
  }
}

function groundPlane(world: World) {
  const ground = createRigid2D({ motion: "static" });
  ground.addShape(new Plane({}));
  world.bodies.add(ground);
  return ground;
}

test("a ball falls onto a plane and comes to rest", () => {
  const world = new World();
  groundPlane(world);
  const ball = createRigid2D({ motion: "dynamic", mass: 1, position: V(0, 5) });
  ball.addShape(new Circle({ radius: 0.5 }));
  world.bodies.add(ball);
  let impacts = 0;
  world.on("impact", () => void impacts++, null);

  run(world, 3, [ball]);

  assertClose(ball.position.y, 0.5, 1);
  assert.ok(Math.abs(ball.velocity.y) < 0.05);
  assert.ok(impacts > 0);
  assert.equal(Number.isFinite(ball.angle), true);
});

test("boxes stack on a plane (Convex subclasses use Convex handlers)", () => {
  const world = new World();
  groundPlane(world);
  const lower = createRigid2D({
    motion: "dynamic",
    mass: 1,
    position: V(0, 1),
  });
  lower.addShape(new Box({ width: 1, height: 1 }));
  const upper = createRigid2D({
    motion: "dynamic",
    mass: 1,
    position: V(0.1, 2.5),
  });
  upper.addShape(new Box({ width: 1, height: 1 }));
  world.bodies.add(lower);
  world.bodies.add(upper);

  run(world, 4, [lower, upper]);

  assertClose(lower.position.y, 0.5, 1);
  assertClose(upper.position.y, 1.5, 1);
  assert.ok(Math.abs(lower.angle) < 0.05);
  assert.ok(Math.abs(upper.angle) < 0.1);
});

test("fromPolygon decomposes a concave shape that then collides", () => {
  const world = new World();
  groundPlane(world);
  const lShape = createRigid2D({
    motion: "dynamic",
    mass: 1,
    position: V(0, 3),
  });
  const ok = fromPolygon(lShape, [
    V(0, 0),
    V(2, 0),
    V(2, 1),
    V(1, 1),
    V(1, 2),
    V(0, 2),
  ]);
  assert.equal(ok, true);
  assert.ok(lShape.shapes.length >= 2);
  assert.equal(lShape.concavePath?.length, 6);
  world.bodies.add(lShape);

  run(world, 3, [lShape]);

  assert.ok(lShape.position.y > 0.3);
  assert.ok(lShape.position.y < 2);
  assert.ok(Math.abs(lShape.velocity.y) < 0.1);
});

test("a heightfield body's AABB covers the heightfield", () => {
  const world = new World();
  const terrain = createRigid2D({ motion: "static", position: V(-5, 0) });
  terrain.addShape(
    new Heightfield({ heights: [0, 1, 0, 2, 0, 0], elementWidth: 2 }),
  );
  world.bodies.add(terrain);
  world.step(DT);

  assert.ok(terrain.aabb.lowerBound.x <= -5 && terrain.aabb.upperBound.x >= 5);
  assert.ok(terrain.aabb.lowerBound.y <= 0 && terrain.aabb.upperBound.y >= 2);
});

test("a ball and a box land on a heightfield", () => {
  const world = new World();
  const terrain = createRigid2D({ motion: "static", position: V(-10, 0) });
  terrain.addShape(
    new Heightfield({
      heights: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      elementWidth: 2,
    }),
  );
  world.bodies.add(terrain);
  const ball = createRigid2D({
    motion: "dynamic",
    mass: 1,
    position: V(-4, 2),
  });
  ball.addShape(new Circle({ radius: 0.5 }));
  world.bodies.add(ball);
  const box = createRigid2D({ motion: "dynamic", mass: 1, position: V(4, 2) });
  box.addShape(new Box({ width: 1, height: 1 }));
  world.bodies.add(box);

  run(world, 3, [ball, box]);

  // Resting on the surface (y = 0), not pushed into it
  assertClose(ball.position.y, 0.5, 1);
  assertClose(box.position.y, 0.5, 1);
});
