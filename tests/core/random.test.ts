import assert from "node:assert/strict";
import { test } from "node:test";
import {
  choose,
  makeRandom,
  reseedIfSeeded,
  rUniform,
  seedRandom,
  takeWeighted,
} from "../../src/core/util/Random";

test("seeding makes the sequence repeat", () => {
  seedRandom(42);
  const first = [rUniform(0, 1), rUniform(0, 1), choose("a", "b", "c")];
  seedRandom(42);
  const second = [rUniform(0, 1), rUniform(0, 1), choose("a", "b", "c")];
  assert.deepEqual(first, second);

  // Reseeding from an offset is independent of what was used before it
  seedRandom(7);
  rUniform(0, 1);
  reseedIfSeeded(3);
  const afterSome = rUniform(0, 1);
  seedRandom(7);
  reseedIfSeeded(3);
  assert.equal(rUniform(0, 1), afterSome);
});

test("makeRandom is its own sequence, in [0, 1)", () => {
  const a = makeRandom(1);
  const b = makeRandom(1);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
});

test("takeWeighted removes what it picks, and never picks weight 0", () => {
  seedRandom(1);
  for (let i = 0; i < 100; i++) {
    const pool = ["never", "a", "b"];
    const picked = takeWeighted(pool, (s) => (s === "never" ? 0 : 1));
    assert.notEqual(picked, "never");
    assert.equal(pool.length, 2);
    assert.ok(!pool.includes(picked));
  }
});
