/**
 * Deterministic micro-models behind cpu-memory worlds.
 *
 * These are deliberately simple, but they are REAL models: the counters a
 * learner inspects are produced by running an address stream through an
 * actual set-associative LRU cache, a two-core write-coherence ledger, and a
 * next-line prefetcher. Nothing here is authored narrative — if the world
 * claims conflict misses, these functions really evicted hot lines from one
 * set to produce that claim.
 */

// ---------------------------------------------------------------------------
// Address layout helpers
// ---------------------------------------------------------------------------

export interface CacheGeometry {
  /** Total data size in bytes. */
  sizeBytes: number;
  lineSizeBytes: number;
  associativity: number;
}

export function setCount(geo: CacheGeometry): number {
  return geo.sizeBytes / (geo.lineSizeBytes * geo.associativity);
}

/** Set index for a byte address (simple bit-slicing, no hash). */
export function setIndexOf(addr: number, geo: CacheGeometry): number {
  return Math.floor(addr / geo.lineSizeBytes) % setCount(geo);
}

// ---------------------------------------------------------------------------
// Access stream description
// ---------------------------------------------------------------------------

export type Pattern =
  | { kind: "sequential"; base: number; count: number; lineSizeBytes?: number }
  | { kind: "strided"; base: number; stride: number; count: number }
  | { kind: "hot-set-cycle"; addrs: number[] } // cyclic sweep of chosen lines
  | { kind: "sweep-over"; base: number; lines: number }; // touch N distinct lines once

/** Expand a pattern into an explicit byte-address stream. */
export function expand(pattern: Pattern): number[] {
  switch (pattern.kind) {
    case "sequential": {
      const step = pattern.lineSizeBytes ?? 64;
      return Array.from({ length: pattern.count }, (_, i) => pattern.base + i * step);
    }
    case "strided":
      return Array.from({ length: pattern.count }, (_, i) => pattern.base + i * pattern.stride);
    case "hot-set-cycle":
      return [...pattern.addrs];
    case "sweep-over":
      return Array.from({ length: pattern.lines }, (_, i) => pattern.base + i * 64);
  }
}

// ---------------------------------------------------------------------------
// Set-associative LRU cache
// ---------------------------------------------------------------------------

/**
 * Set-associative LRU cache with per-tag hit tracking.
 *
 * `hotTagHits` counts REPEATED accesses (hits) per tag, so diagnostic code
 * can tell "one line accessed 1000 times" (trivially cached) from "a handful
 * of lines cycling fast enough to thrash" (a genuine conflict).
 */
export interface CacheStats {
  accesses: number;
  hits: number;
  misses: number;
  /** Misses per set index. */
  missesPerSet: Record<number, number>;
  evictions: number;
  /** Distinct cache lines touched. */
  distinctLines: number;
  /** Repeat accesses (hits) per line tag — the churn signal. */
  hotTagHits: Record<string, number>;
}

class SetAssocLru {
  private sets: Map<number, number[]>;
  private stats: CacheStats;
  private geo: CacheGeometry;
  private loadedTags = new Set<number>();

  constructor(geo: CacheGeometry) {
    this.geo = geo;
    this.sets = new Map();
    this.stats = {
      accesses: 0,
      hits: 0,
      misses: 0,
      missesPerSet: {},
      evictions: 0,
      distinctLines: 0,
      hotTagHits: {},
    };
    for (let s = 0; s < setCount(geo); s++) this.sets.set(s, []);
  }

  access(addr: number): void {
    const set = setIndexOf(addr, this.geo);
    const tag = Math.floor(addr / this.geo.lineSizeBytes);
    const lines = this.sets.get(set) as number[];
    const idx = lines.indexOf(tag);
    this.stats.accesses += 1;
    if (idx >= 0) {
      this.stats.hits += 1;
      const key = `${set}:${tag}`;
      this.stats.hotTagHits[key] = (this.stats.hotTagHits[key] ?? 0) + 1;
      lines.splice(idx, 1);
      lines.push(tag); // refresh LRU
      return;
    }
    this.stats.misses += 1;
    this.stats.missesPerSet[set] = (this.stats.missesPerSet[set] ?? 0) + 1;
    if (!this.loadedTags.has(tag)) {
      this.stats.distinctLines += 1;
      this.loadedTags.add(tag);
    }
    if (lines.length >= this.geo.associativity) {
      lines.shift(); // evict LRU
      this.stats.evictions += 1;
    }
    lines.push(tag);
  }

  getStats(): CacheStats {
    return {
      ...this.stats,
      missesPerSet: { ...this.stats.missesPerSet },
      hotTagHits: { ...this.stats.hotTagHits },
    };
  }
}

export function runCacheStream(addrs: number[], geo: CacheGeometry): CacheStats {
  const cache = new SetAssocLru(geo);
  for (const a of addrs) cache.access(a);
  return cache.getStats();
}

/**
 * Run one continuous stream but report miss rate per window (for timeline
 * evidence). Windows share cache state — a cold phase pollutes only the
 * early windows, exactly like reality.
 */
export function runCacheStreamWindows(
  addrs: number[],
  geo: CacheGeometry,
  windows: number,
): number[] {
  const cache = new SetAssocLru(geo);
  const chunkSize = Math.max(1, Math.ceil(addrs.length / windows));
  const rates: number[] = [];
  for (let w = 0; w < windows; w++) {
    const chunk = addrs.slice(w * chunkSize, (w + 1) * chunkSize);
    if (chunk.length === 0) {
      rates.push(rates.length ? (rates[rates.length - 1] as number) : 0);
      continue;
    }
    const before = cache.getStats();
    for (const a of chunk) cache.access(a);
    const after = cache.getStats();
    const misses = after.misses - before.misses;
    rates.push(misses / chunk.length);
  }
  return rates;
}

/** Set-index skew: highest per-set miss count divided by the median nonzero set. */
export function setSkew(stats: CacheStats): number {
  const counts = Object.values(stats.missesPerSet).filter((c) => c > 0).sort((a, b) => a - b);
  if (counts.length === 0) return 1;
  const median = counts[Math.floor(counts.length / 2)] as number;
  const max = counts[counts.length - 1] as number;
  return median === 0 ? max : max / median;
}

/**
 * Churn concentration among REPEATED accesses (hits). A conflict-miss world
 * has a handful of tags eating thousands of hits; a one-line spin loop also
 * concentrates hits but into a SINGLE tag with zero evictions. The caller
 * distinguishes those by eviction count.
 */
export function hitConcentration(stats: CacheStats): { ratio: number; topTag: string | null } {
  const entries = Object.entries(stats.hotTagHits);
  if (entries.length === 0) return { ratio: 1, topTag: null };
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  const max = sorted[0]![1];
  const median = sorted.length >= 3 ? (sorted[Math.floor(sorted.length / 2)] as [string, number])[1] : Math.min(max, 1);
  return { ratio: max / Math.max(1, median), topTag: sorted[0]![0] };
}

// ---------------------------------------------------------------------------
// Coherence ledger (two-core false sharing)
// ---------------------------------------------------------------------------

export interface CoherenceStats {
  /** Lines written alternately by both cores. */
  contendedLines: number;
  crossCoreInvalidations: number;
  localWrites: number;
  /** True when invalidation traffic dominates capacity misses. */
  invalidationDominated: boolean;
}

/**
 * Model: writes alternate between core0/core1 on the given word offsets.
 * Every time the writer differs from the previous writer on the same line,
 * the other core's copy is invalidated (a coherence transfer).
 */
export function runCoherence(
  writeSequence: Array<{ core: 0 | 1; addr: number }>,
  lineSizeBytes: number,
): CoherenceStats {
  let cross = 0;
  let local = 0;
  const lastWriter = new Map<number, 0 | 1>();
  const contendedLines = new Set<number>();
  for (const w of writeSequence) {
    const line = Math.floor(w.addr / lineSizeBytes);
    const prev = lastWriter.get(line);
    if (prev !== undefined && prev !== w.core) {
      cross += 1;
      contendedLines.add(line);
    } else {
      local += 1;
    }
    lastWriter.set(line, w.core);
  }
  return {
    contendedLines: contendedLines.size,
    crossCoreInvalidations: cross,
    localWrites: local,
    invalidationDominated: cross > local * 2 && cross > 64,
  };
}

// ---------------------------------------------------------------------------
// Next-line prefetcher model
// ---------------------------------------------------------------------------

export interface PrefetchStats {
  issued: number;
  useful: number;
  useless: number;
  usefulFraction: number;
  /** Bus utilization estimate: demand misses + prefetches over window. */
  busTransactions: number;
}

/**
 * Next-line prefetcher: on a miss to line L it issues L+1. Returns how many
 * prefetched lines were ever demanded afterwards.
 */
export function runPrefetch(addrs: number[], geo: CacheGeometry): PrefetchStats {
  const demandedLines = new Set<number>();
  for (const a of addrs) demandedLines.add(Math.floor(a / geo.lineSizeBytes));
  const stats = runCacheStream(addrs, geo);
  const issued = stats.misses; // one prefetch per demand miss
  let useful = 0;
  for (const line of demandedLines) {
    if (demandedLines.has(line + 1)) useful += 1;
  }
  // usefulness capped by prefetches actually issued
  useful = Math.min(useful, issued);
  const useless = issued - useful;
  return {
    issued,
    useful,
    useless,
    usefulFraction: issued === 0 ? 0 : useful / issued,
    busTransactions: stats.misses + issued,
  };
}

// ---------------------------------------------------------------------------
// Cycle estimator (honest slowdown arithmetic)
// ---------------------------------------------------------------------------

export interface CycleModel {
  baseCpi: number;
  hitPenaltyCycles: number;
  missPenaltyCycles: number;
  coherenceStallCycles: number;
  busContentionFactor: number;
}

export function estimateCycles(
  stats: CacheStats,
  coherence: CoherenceStats | null,
  prefetch: PrefetchStats | null,
  model: CycleModel,
): number {
  const misses = stats.misses;
  let stalls = misses * model.missPenaltyCycles;
  if (coherence) stalls += coherence.crossCoreInvalidations * model.coherenceStallCycles;
  if (prefetch) stalls *= 1 + Math.max(0, 1 - prefetch.usefulFraction) * model.busContentionFactor * 0.5;
  return Math.round(stats.accesses * model.baseCpi + stats.hits * model.hitPenaltyCycles + stalls);
}

export const DEFAULT_CYCLE_MODEL: CycleModel = {
  baseCpi: 1,
  hitPenaltyCycles: 0,
  missPenaltyCycles: 120,
  coherenceStallCycles: 90,
  busContentionFactor: 0.8,
};
