import assert from "node:assert/strict";
import { test } from "node:test";
import { BaseEntity } from "../../src/core/entity/BaseEntity";
import {
  getEntityBodies,
  getShapeCorners,
} from "../../src/core/lighting/casters";
import { createRigid2D } from "../../src/core/physics/body/bodyFactories";
import { Box } from "../../src/core/physics/shapes/Box";
import { Capsule } from "../../src/core/physics/shapes/Capsule";
import { Circle } from "../../src/core/physics/shapes/Circle";
import { Line } from "../../src/core/physics/shapes/Line";

/** Corners rounded to 6 places, as plain pairs, sorted */
function corners(points: readonly (readonly number[])[]): number[][] {
  return points
    .map(([x, y]) => [
      Math.round(x * 1e6) / 1e6 + 0,
      Math.round(y * 1e6) / 1e6 + 0,
    ])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

test("shape corners are in world coordinates", () => {
  const body = createRigid2D({
    motion: "static",
    position: [10, 5],
    angle: Math.PI / 2,
  });
  const box = new Box({ width: 2, height: 1 });
  body.addShape(box);
  // Turned a quarter, a 2 by 1 box is 1 wide and 2 tall
  assert.deepEqual(corners(getShapeCorners(box, body)), [
    [9.5, 4],
    [9.5, 6],
    [10.5, 4],
    [10.5, 6],
  ]);

  const line = new Line({ length: 4 });
  body.addShape(line, [1, 0]);
  // Offset 1 along the body's x, which points along the world's y
  assert.deepEqual(corners(getShapeCorners(line, body)), [
    [10, 4],
    [10, 8],
  ]);
});

test("capsules cast as boxes, and circles don't cast", () => {
  const body = createRigid2D({ motion: "static", position: [0, 0] });
  const capsule = new Capsule({ length: 2, radius: 0.5 });
  const circle = new Circle({ radius: 1 });
  body.addShape(capsule);
  body.addShape(circle);
  assert.deepEqual(corners(getShapeCorners(capsule, body)), [
    [-1, -0.5],
    [-1, 0.5],
    [1, -0.5],
    [1, 0.5],
  ]);
  assert.deepEqual(getShapeCorners(circle, body), []);
});

test("an entity's bodies are its body and its bodies", () => {
  const one = createRigid2D({ motion: "static" });
  const two = createRigid2D({ motion: "static" });
  const three = createRigid2D({ motion: "static" });
  class Single extends BaseEntity {
    body = one;
  }
  class Several extends BaseEntity {
    body = one;
    bodies = [two, three];
  }
  class None extends BaseEntity {}
  assert.deepEqual(getEntityBodies(new Single()), [one]);
  assert.deepEqual(getEntityBodies(new Several()), [one, two, three]);
  assert.deepEqual(getEntityBodies(new None()), []);
});
