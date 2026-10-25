import assert from "node:assert/strict";
import { test } from "node:test";
import {
  choose,
  cosmeticRandom,
  Random,
  random,
  rRound,
  rUniform,
  seededShuffle,
  seedRandom,
  takeWeighted,
  WeightedSelector,
} from "../../src/core/util/Random";

test("seeding makes the sequence repeat", () => {
  seedRandom(42);
  const first = [rUniform(0, 1), rUniform(0, 1), choose("a", "b", "c")];
  seedRandom(42);
  const second = [rUniform(0, 1), rUniform(0, 1), choose("a", "b", "c")];
  assert.deepEqual(first, second);
});

test("a run plays again from the seed it reports", () => {
  const original = new Random();
  const drawn = [original.next(), original.integer(0, 100), original.bool()];
  const again = new Random(original.seed);
  assert.deepEqual([again.next(), again.integer(0, 100), again.bool()], drawn);
});

test("the free functions draw from `random`", () => {
  seedRandom(5);
  const fromFunction = rUniform(0, 1);
  seedRandom(5);
  assert.equal(random.uniform(0, 1), fromFunction);
});

test("a fork depends only on the seed and its name", () => {
  const a = new Random(7);
  const b = new Random(7);
  b.next();
  b.next();
  b.fork("other").next();
  assert.equal(a.fork("layout").next(), b.fork("layout").next());
  assert.equal(a.fork(3).next(), a.fork("3").next());

  // Different names, or different seeds, give different sequences
  assert.notEqual(a.fork("layout").next(), a.fork("loot").next());
  assert.notEqual(a.fork("layout").next(), new Random(8).fork("layout").next());
  // And a fork isn't its parent
  assert.notEqual(a.fork("layout").next(), new Random(7).next());
});

test("cosmeticRandom doesn't disturb `random`", () => {
  seedRandom(9);
  const undisturbed = [rUniform(0, 1), rUniform(0, 1)];
  seedRandom(9);
  const disturbed = [rUniform(0, 1)];
  cosmeticRandom.next();
  disturbed.push(rUniform(0, 1));
  assert.deepEqual(disturbed, undisturbed);
});

test("numbers are in [0, 1)", () => {
  const r = new Random(1);
  for (let i = 0; i < 1000; i++) {
    const x = r.next();
    assert.ok(x >= 0 && x < 1);
  }
});

test("rRound rounds to the nearer integer more often", () => {
  seedRandom(2);
  let up = 0;
  for (let i = 0; i < 1000; i++) {
    const rounded = rRound(2.9);
    assert.ok(rounded === 2 || rounded === 3);
    if (rounded === 3) up++;
  }
  assert.ok(up > 800, `rounded up ${up} times out of 1000`);
});

test("seededShuffle depends only on the seed", () => {
  const list = () => [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(seededShuffle(list(), 4), seededShuffle(list(), 4));
  assert.deepEqual(seededShuffle(list(), 4).sort(), list());
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

test("WeightedSelector picks from the generator it's given", () => {
  const selector = new WeightedSelector([
    ["a", 1],
    ["b", 1],
    ["c", 1],
  ]);
  const picks = (seed: number) => {
    const r = new Random(seed);
    return Array.from({ length: 10 }, () => selector.pick(r));
  };
  assert.deepEqual(picks(3), picks(3));
});
