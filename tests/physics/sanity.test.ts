// Headless sanity checks for the 2D physics engine. These run in Node (no
// browser) and exercise the solver end to end: contacts, constraints, springs,
// concave decomposition, raycasts, and sleeping.
import assert from "node:assert/strict";
import { test } from "node:test";
import { V } from "../../src/core/Vector";
import type { Body } from "../../src/core/physics/body/Body";
import {
  createPointMass2D,
  createRigid2D,
} from "../../src/core/physics/body/bodyFactories";
import { DistanceConstraint } from "../../src/core/physics/constraints/DistanceConstraint";
import { LockConstraint } from "../../src/core/physics/constraints/LockConstraint";
import { RevoluteConstraint } from "../../src/core/physics/constraints/RevoluteConstraint";
import { Box } from "../../src/core/physics/shapes/Box";
import { Circle } from "../../src/core/physics/shapes/Circle";
import { Plane } from "../../src/core/physics/shapes/Plane";
import { LinearSpring } from "../../src/core/physics/springs/LinearSpring";
import { fromPolygon } from "../../src/core/physics/utils/fromPolygon";
import { SleepMode, World } from "../../src/core/physics/world/World";

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

test("a revolute joint keeps a pendulum at fixed length", () => {
  const world = new World();
  const anchor = createRigid2D({ motion: "static", position: V(0, 0) });
  const bob = createRigid2D({ motion: "dynamic", mass: 1, position: V(1, 0) });
  bob.addShape(new Circle({ radius: 0.1 }));
  world.bodies.add(anchor);
  world.bodies.add(bob);
  world.constraints.add(
    new RevoluteConstraint(anchor, bob, { worldPivot: V(0, 0) }),
  );

  let minY = 0;
  for (let i = 0; i < 2 / DT; i++) {
    bob.applyForce(V(0, GRAVITY));
    world.step(DT);
    minY = Math.min(minY, bob.position.y);
  }

  assertClose(bob.position.magnitude, 1, 1);
  assert.ok(minY < -0.9);
});

test("distance constraints hold point-point and point-rigid pairs", () => {
  const world = new World();
  const pinned = createPointMass2D({ motion: "static", position: V(0, 0) });
  const point = createPointMass2D({
    motion: "dynamic",
    mass: 1,
    position: V(0, -1),
  });
  const rigid = createRigid2D({
    motion: "dynamic",
    mass: 1,
    position: V(0, -2),
  });
  rigid.addShape(new Box({ width: 0.4, height: 0.4 }));
  world.bodies.add(pinned);
  world.bodies.add(point);
  world.bodies.add(rigid);
  world.constraints.add(new DistanceConstraint(pinned, point, { distance: 1 }));
  world.constraints.add(new DistanceConstraint(point, rigid, { distance: 1 }));
  point.velocity.set(2, 0);

  run(world, 2, [point, rigid]);

  assertClose(point.position.sub(pinned.position).magnitude, 1, 1);
  assertClose(rigid.position.sub(point.position).magnitude, 1, 1);
});

test("a lock constraint holds a rigid offset and angle", () => {
  const world = new World();
  const a = createRigid2D({ motion: "dynamic", mass: 1, position: V(0, 0) });
  a.addShape(new Box({ width: 1, height: 1 }));
  const b = createRigid2D({ motion: "dynamic", mass: 1, position: V(2, 0) });
  b.addShape(new Box({ width: 1, height: 1 }));
  world.bodies.add(a);
  world.bodies.add(b);
  world.constraints.add(
    new LockConstraint(a, b, { localOffsetB: V(2, 0), localAngleB: 0 }),
  );
  // Kick the pair so it both spins and translates
  b.applyImpulse(V(0, 3), V(0.5, 0));

  run(world, 2);

  const offset = b.position.sub(a.position).rotate(-a.angle);
  assertClose(offset.x, 2, 1);
  assertClose(offset.y, 0, 1);
  assertClose(b.angle - a.angle, 0, 1);
  assert.ok(a.position.magnitude > 0.1);
});

test("a linear spring settles at its rest length", () => {
  const world = new World();
  const anchor = createRigid2D({ motion: "static" });
  const mass = createRigid2D({
    motion: "dynamic",
    mass: 1,
    position: V(3, 0),
    damping: 0.5,
  });
  world.bodies.add(anchor);
  world.bodies.add(mass);
  world.addSpring(
    new LinearSpring(anchor, mass, {
      restLength: 1,
      stiffness: 50,
      damping: 5,
    }),
  );

  run(world, 5);

  assertClose(mass.position.magnitude, 1, 1);
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

test("raycast hits a circle", () => {
  const world = new World();
  const target = createRigid2D({ motion: "static", position: V(5, 0) });
  target.addShape(new Circle({ radius: 1 }));
  world.bodies.add(target);

  const hit = world.raycast(V(0, 0), V(10, 0));

  assert.equal(hit?.body, target);
  assertClose(hit?.fraction, 0.4, 3);
});

test("a resting body falls asleep", () => {
  const world = new World();
  world.sleepMode = SleepMode.BODY_SLEEPING;
  groundPlane(world);
  const ball = createRigid2D({
    motion: "dynamic",
    mass: 1,
    position: V(0, 1),
    allowSleep: true,
    sleepSpeedLimit: 0.1,
    sleepTimeLimit: 0.5,
  });
  ball.addShape(new Circle({ radius: 0.5 }));
  world.bodies.add(ball);

  run(world, 4, [ball]);

  assert.equal(ball.isSleeping(), true);
});
