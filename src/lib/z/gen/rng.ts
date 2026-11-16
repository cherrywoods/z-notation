// Small seeded PRNG (mulberry32) for the example generator: the same seed always
// gives the same example. Independent streams are derived from (seed, salt).

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  chance(p: number): boolean;
  pick<T>(xs: readonly T[]): T;
  /** Index chosen with probability proportional to its weight. */
  weighted(weights: readonly number[]): number;
  /** Shuffled copy. */
  shuffle<T>(xs: readonly T[]): T[];
  /** k distinct elements (in random order). */
  sample<T>(xs: readonly T[], k: number): T[];
}

/** FNV-1a hash of a string to 32 bits. */
function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed: number, salt = ''): Rng {
  let a = hash(`${seed}|${salt}`);
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  };
  return {
    next,
    int,
    chance: (p) => next() < p,
    pick: (xs) => xs[int(xs.length)],
    weighted(weights) {
      let total = 0;
      for (const w of weights) total += Math.max(0, w);
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= Math.max(0, weights[i]);
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    shuffle,
    sample: (xs, k) => shuffle(xs).slice(0, Math.max(0, k)),
  };
}
