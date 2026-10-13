/**
 * Tests for the musical clock's maths (`src/core/sound/music/musicClock.ts`):
 * the next bar line and phrase boundary from a piece's start, through its
 * loops. Plain node, no browser: `npm run test:music`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  barInLoop,
  nextBar,
  nextGridTime,
  nextPhrase,
  nextPhraseWithLeadIn,
} from "../../src/core/sound/music/musicClock";

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} isn't ${expected}`);

// A bar of 4/4 at 150: 1.6 s, phrases of 8 bars (12.8 s)
const grid = { barLength: 1.6, phraseBars: 8 };

test("before a piece starts, its next grid line is its start", () => {
  close(nextGridTime(10, 1.6, 3), 10);
  close(nextBar(grid, 10, 9.99), 10);
});

test("a time on a grid line is that line, even with float error", () => {
  close(nextBar(grid, 10, 10 + 1.6 * 5), 10 + 1.6 * 5);
  close(nextBar(grid, 0.1, 0.1 + 0.1 * 16 + 1e-12), 0.1 + 1.6);
  close(nextBar(grid, 0.1, 0.1 + 0.1 * 16 - 1e-12), 0.1 + 1.6);
});

test("between grid lines, the next one", () => {
  close(nextBar(grid, 10, 10.01), 11.6);
  close(nextPhrase(grid, 10, 10.01), 22.8);
  close(nextPhrase(grid, 10, 22.81), 35.6);
});

test("the grid carries on through the loop: phrase boundaries every 12.8 s forever", () => {
  // A 24-bar loop (3 phrases) started at 2 s, an hour in
  const start = 2;
  const t = 3600.3;
  const boundary = nextPhrase(grid, start, t);
  const phrases = (boundary - start) / 12.8;
  close(phrases, Math.round(phrases));
  assert.ok(boundary >= t && boundary - t < 12.8);
  assert.equal(
    barInLoop(grid, start, 24, boundary),
    (Math.round(phrases) * 8) % 24,
  );
});

test("a switch with a transition a bar early leaves at least that bar", () => {
  const start = 0;
  // Half a bar before a phrase boundary: too late for its transition
  const at = nextPhraseWithLeadIn(grid, start, 12.0, 1);
  close(at, 25.6);
  // Over a bar before: that boundary
  close(nextPhraseWithLeadIn(grid, start, 11.1, 1), 12.8);
  // Exactly a bar before: that boundary
  close(nextPhraseWithLeadIn(grid, start, 11.2, 1), 12.8);
});

test("which bar of the loop is playing wraps round the loop point", () => {
  assert.equal(barInLoop(grid, 0, 16, 0), 0);
  assert.equal(barInLoop(grid, 0, 16, 1.59), 0);
  assert.equal(barInLoop(grid, 0, 16, 1.6), 1);
  assert.equal(barInLoop(grid, 0, 16, 16 * 1.6 + 0.1), 0);
  assert.equal(barInLoop(grid, 0, 16, 31 * 1.6 + 0.1), 15);
});
