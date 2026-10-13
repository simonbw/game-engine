/**
 * The maths of playing music in time: a piece starts at some time on the
 * audio clock, and its bars and phrases follow on from there, through every
 * loop (a loop is a whole number of phrases), so a switch can be put on the
 * next bar line or phrase boundary. Times are seconds on the `AudioContext`'s
 * clock; nothing here touches audio.
 */

/** How a piece's time is laid out */
export interface MusicGrid {
  /** Seconds a bar */
  readonly barLength: number;
  /** Bars a phrase: the boundaries switches go on */
  readonly phraseBars: number;
}

/** Leeway for float error: a time this close to a grid line is on it */
const EPSILON = 1e-6;

/**
 * The first time at or after `after` that's `start` plus a whole number of
 * `unit`s, and never before `start`
 */
export function nextGridTime(
  start: number,
  unit: number,
  after: number,
): number {
  if (after <= start + EPSILON) {
    return start;
  }
  return start + Math.ceil((after - start) / unit - EPSILON) * unit;
}

/** The next bar line at or after `after`, for a piece whose bar 1 began at `start` */
export function nextBar(grid: MusicGrid, start: number, after: number): number {
  return nextGridTime(start, grid.barLength, after);
}

/** The next phrase boundary at or after `after`, for a piece whose bar 1 began at `start` */
export function nextPhrase(
  grid: MusicGrid,
  start: number,
  after: number,
): number {
  return nextGridTime(start, grid.barLength * grid.phraseBars, after);
}

/**
 * The next phrase boundary that leaves at least `barsBefore` bars between
 * `after` and it: for a switch whose transition starts that many bars
 * early, and has to be scheduled before then
 */
export function nextPhraseWithLeadIn(
  grid: MusicGrid,
  start: number,
  after: number,
  barsBefore: number,
): number {
  return nextPhrase(grid, start, after + barsBefore * grid.barLength);
}

/** Which bar of the loop is playing at `time` (0-based), for a loop of `loopBars` bars */
export function barInLoop(
  grid: MusicGrid,
  start: number,
  loopBars: number,
  time: number,
): number {
  const bars = Math.floor((time - start) / grid.barLength + EPSILON);
  return ((bars % loopBars) + loopBars) % loopBars;
}
