/**
 * Random numbers. Everything draws from a `Random`: a seeded generator
 * (mulberry32: small and fast) that carries on from where it got to.
 *
 * - `random` is the game's own: the free functions (`choose`, `rUniform`...)
 *   draw from it, and `game.random` is the same one. It's seeded when the
 *   game starts (`new Game({ seed })`, else a seed of its own that it
 *   reports), so any run can be played again.
 * - `random.fork(name)` is a sequence of its own, worked out from the seed and
 *   the name alone, for something that has to come out the same however much
 *   randomness was used before it (a level generated over several frames).
 *   Code that has to be reproducible takes a `Random` and draws only from it.
 * - `cosmeticRandom` is for things that only affect looks and sound, so that
 *   changing them never changes a seeded run.
 */

/** A seed of its own, for when none was given */
function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

/** Mixes `name` into `seed` (FNV-1a over the name, then a finalizer) */
function hashSeed(seed: number, name: string): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A seeded random number generator */
export class Random {
  private _seed: number;
  private state: number;

  /** Seed should be an integer. Without one, it picks one of its own. */
  constructor(seed: number = newSeed()) {
    this._seed = seed >>> 0;
    this.state = this._seed | 0;
  }

  /** What this started from. `new Random(seed)` gives the same sequence. */
  get seed(): number {
    return this._seed;
  }

  /** Starts again from `seed` */
  reseed(seed: number): void {
    this._seed = seed >>> 0;
    this.state = this._seed | 0;
  }

  /**
   * A sequence of its own, worked out from this one's seed and `name` alone:
   * the same however much has been drawn from this one, or from other forks.
   * The same name gives the same sequence, so for a new one each time, name
   * them apart (`fork(\`layout-${n}\`)`).
   */
  fork(name: string | number): Random {
    return new Random(hashSeed(this._seed, String(name)));
  }

  /** A number in [0, 1) */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A number in [0, 1), [0, `max`), or [`min`, `max`) */
  uniform(min?: number, max?: number): number {
    if (min === undefined) {
      return this.next();
    }
    if (max === undefined) {
      max = min;
      min = 0;
    }
    return (max - min) * this.next() + min;
  }

  /** An integer in [min, max) */
  integer(min: number, max: number): number {
    return Math.floor(this.uniform(min, max));
  }

  /** An integer in [0, 256) */
  byte(): number {
    return this.integer(0, 256);
  }

  /** True with the chance given */
  bool(chanceOfTrue: number = 0.5): boolean {
    return this.next() < chanceOfTrue;
  }

  /** 1 with the chance given, else -1 */
  sign(chanceOfPositive: number = 0.5): -1 | 1 {
    return this.bool(chanceOfPositive) ? 1 : -1;
  }

  /**
   * A number from an (approximately) normal distribution centered at `mean`
   * with standard deviation `deviation`
   */
  normal(mean: number = 0.0, deviation: number = 1.0): number {
    const sum =
      this.next() +
      this.next() +
      this.next() +
      this.next() +
      this.next() +
      this.next();
    return (deviation * (sum - 3)) / 3 + mean;
  }

  /** An angle in radians */
  direction(): number {
    return this.uniform(0, Math.PI * 2);
  }

  /** One of the four cardinal directions, in radians */
  cardinal(): number {
    return this.choose(0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2);
  }

  /** Rounds x up or down, more likely to whichever integer is nearer */
  round(x: number): number {
    const low = Math.floor(x);
    return this.bool(x - low) ? low + 1 : low;
  }

  /** One of the options */
  choose<T>(...options: T[]): T {
    return options[this.integer(0, options.length)];
  }

  /** Removes and returns an element of the array */
  take<T>(options: T[]): T {
    return options.splice(this.integer(0, options.length), 1)[0];
  }

  /** Puts an array into a random order, and returns it */
  shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.integer(0, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * One of the items, each as likely as its weight (which must be >= 0). For
   * many picks from the same items, see `WeightedSelector`.
   */
  chooseWeighted<T>(items: readonly T[], getWeight: (item: T) => number): T {
    if (items.length === 0) throw new Error("No items to choose from");

    let totalWeight = 0;
    for (const item of items) {
      const weight = getWeight(item);
      if (weight < 0) {
        throw new Error("Weight must be >= 0");
      }
      totalWeight += weight;
    }

    if (totalWeight <= 0) throw new Error("Total weight must be > 0");

    // Pick random point in weight space
    let pick = this.next() * totalWeight;
    for (const item of items) {
      pick -= getWeight(item);
      if (pick <= 0) return item;
    }

    // Fallback for floating point edge cases
    return items[items.length - 1];
  }

  /** Removes and returns one element of `pool`, each as likely as its `weight` */
  takeWeighted<T>(pool: T[], weight: (t: T) => number): T {
    const total = pool.reduce((sum, t) => sum + weight(t), 0);
    let roll = this.uniform(0, total);
    let index = 0;
    while (index < pool.length - 1 && roll >= weight(pool[index])) {
      roll -= weight(pool[index]);
      index++;
    }
    return pool.splice(index, 1)[0];
  }
}

/** The game's own random numbers, which the functions below draw from */
export const random = new Random();

/** For things that only affect looks and sound, so they never change a seeded run */
export const cosmeticRandom = new Random();

/** Makes `random` start again from `seed`. Seed should be an integer. */
export function seedRandom(seed: number): void {
  random.reseed(seed);
}

/** A number in [0, 1), [0, `max`), or [`min`, `max`) */
export function rUniform(min?: number, max?: number): number {
  return random.uniform(min, max);
}

/** An angle in radians */
export function rDirection(): number {
  return random.direction();
}

/** One of the four cardinal directions, in radians */
export function rCardinal(): number {
  return random.cardinal();
}

/**
 * A number from an (approximately) normal distribution centered at `mean`
 * with standard deviation `deviation`
 */
export function rNormal(mean: number = 0.0, deviation: number = 1.0): number {
  return random.normal(mean, deviation);
}

/** True with the chance given */
export function rBool(chanceOfTrue: number = 0.5): boolean {
  return random.bool(chanceOfTrue);
}

/** 1 with the chance given, else -1 */
export function rSign(chanceOfPositive: number = 0.5): -1 | 1 {
  return random.sign(chanceOfPositive);
}

/** An integer in [min, max) */
export function rInteger(min: number, max: number): number {
  return random.integer(min, max);
}

/** An integer in [0, 256) */
export function rByte(): number {
  return random.byte();
}

/** Rounds x up or down, more likely to whichever integer is nearer */
export function rRound(x: number): number {
  return random.round(x);
}

/** One of the options */
export function choose<T>(...options: T[]): T {
  return random.choose(...options);
}

/** Removes and returns an element of the array */
export function take<T>(options: T[]): T {
  return random.take(options);
}

/** Puts an array into a random order, and returns it */
export function shuffle<T>(a: T[]): T[] {
  return random.shuffle(a);
}

/** Puts an array into an order that depends only on `seed`, and returns it */
export function seededShuffle<T>(a: T[], seed: number): T[] {
  return new Random(seed).shuffle(a);
}

/** One of the items, each as likely as its weight (which must be >= 0) */
export function chooseWeighted<T>(
  items: readonly T[],
  getWeight: (item: T) => number,
): T {
  return random.chooseWeighted(items, getWeight);
}

/** Removes and returns one element of `pool`, each as likely as its `weight` */
export function takeWeighted<T>(pool: T[], weight: (t: T) => number): T {
  return random.takeWeighted(pool, weight);
}

/**
 * Efficient weighted random selection with precomputed cumulative weights.
 * Use when making repeated selections from the same weighted set.
 */
export class WeightedSelector<T> {
  private items: T[] = [];
  private weights: number[] = [];
  private cumulative: number[] = [];
  private itemToIndex: Map<T, number> = new Map();
  private dirty = false;
  private _totalWeight = 0;

  constructor(items?: Iterable<[T, number]>) {
    if (items) {
      for (const [item, weight] of items) {
        this.add(item, weight);
      }
    }
  }

  /** Add an item with its weight. Weight must be >= 0. */
  add(item: T, weight: number): this {
    if (weight < 0) {
      throw new Error("Weight must be >= 0");
    }
    if (this.itemToIndex.has(item)) {
      throw new Error("Item already exists in selector");
    }

    const index = this.items.length;
    this.items.push(item);
    this.weights.push(weight);
    this.itemToIndex.set(item, index);
    this._totalWeight += weight;
    this.dirty = true;

    return this;
  }

  /** Remove an item from the selector. */
  remove(item: T): this {
    const index = this.itemToIndex.get(item);
    if (index === undefined) {
      throw new Error("Item not found in selector");
    }

    this._totalWeight -= this.weights[index];

    // Swap with last element for O(1) removal
    const lastIndex = this.items.length - 1;
    if (index !== lastIndex) {
      const lastItem = this.items[lastIndex];
      this.items[index] = lastItem;
      this.weights[index] = this.weights[lastIndex];
      this.itemToIndex.set(lastItem, index);
    }

    this.items.pop();
    this.weights.pop();
    this.itemToIndex.delete(item);
    this.dirty = true;

    return this;
  }

  /** Remove all items from the selector. */
  clear(): this {
    this.items = [];
    this.weights = [];
    this.cumulative = [];
    this.itemToIndex.clear();
    this._totalWeight = 0;
    this.dirty = false;

    return this;
  }

  /** Pick a random item weighted by the stored weights. Returns undefined if empty. */
  pick(rng: Random = random): T | undefined {
    if (this.items.length === 0) return undefined;
    if (this._totalWeight <= 0) return undefined;

    if (this.dirty) {
      this.rebuild();
    }

    const target = rng.next() * this._totalWeight;

    // Binary search for first cumulative > target
    let low = 0;
    let high = this.cumulative.length - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.cumulative[mid] <= target) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return this.items[low];
  }

  /** The number of items in the selector. */
  get size(): number {
    return this.items.length;
  }

  /** The total weight of all items. */
  get totalWeight(): number {
    return this._totalWeight;
  }

  private rebuild(): void {
    this.cumulative.length = this.weights.length;
    let sum = 0;
    for (let i = 0; i < this.weights.length; i++) {
      sum += this.weights[i];
      this.cumulative[i] = sum;
    }
    this.dirty = false;
  }
}
