/**
 * Deterministic, seedable PRNG (mulberry32) plus sampling helpers.
 *
 * Every stochastic step of generation and simulation draws from a generator
 * forked from the world seed, so a (seed, templateId, domainVersion) triple
 * reproduces a world byte-for-byte on every platform.
 */

/** FNV-1a 32-bit string hash — turns string seeds into uint32 state. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: string | number) {
    this.state = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
    // Scramble once so small seed differences avalanche immediately.
    this.state = (this.state + 0x6d2b79f5) >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    if (hi <= lo) return lo;
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Pick one element uniformly. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: empty list");
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Fisher-Yates shuffle (returns a copy). */
  shuffled<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  /** Pick n distinct elements (or all if fewer available). */
  sample<T>(items: readonly T[], n: number): T[] {
    return this.shuffled(items).slice(0, Math.min(n, items.length));
  }

  /**
   * Fork a child generator deterministically. Children never share stream
   * position with the parent, so adding a forked draw cannot shift earlier
   * or later draws in other code paths.
   */
  fork(label: string): Rng {
    return new Rng(`${this.state.toString(36)}:${label}`);
  }
}
