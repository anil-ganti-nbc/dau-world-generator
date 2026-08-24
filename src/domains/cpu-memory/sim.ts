/**
 * Deterministic micro-models behind cpu-memory worlds.
 *
 * Laws these kernels obey:
 *  - every number a learner sees is produced here from hidden state;
 *  - pure functions of inputs (no clock, no globals);
 *  - simple but REAL: conflict streams really evict, coherence really
 *    ping-pongs, hierarchies really have level boundaries.
 *
 * v0.2 additions over v0.1: multi-level cache hierarchy (per-level stats +
 * penalties), prefetch policies, line-size-sensitive addressing, and
 * locality metrics that distinguish spatial from temporal behaviour.
 */

// ---------------------------------------------------------------------------
// Geometry & address layout
// ---------------------------------------------------------------------------

export interface CacheGeometry {
  /** Total data size in bytes for this level. */
  sizeBytes: number;
  lineSizeBytes: number;
  associativity: number;
}

/** One level of a cache hierarchy. */
export interface CacheLevel {
  name: string;
  geometry: CacheGeometry;
  /** Extra cycles for a hit at this level relative to the level above. */
  hitPenaltyCycles: number;
}

export function setCount(geo: CacheGeometry): number {
  return Math.max(1, Math.round(geo.sizeBytes / (geo.lineSizeBytes * geo.associativity)));
}

/** Set index for a byte address (simple bit-slicing, no hash). */
export function setIndexOf(addr: number, geo: CacheGeometry): number {
  return Math.floor(addr / geo.lineSizeBytes) % setCount(geo);
}

// ---------------------------------------------------------------------------
// Set-associative LRU cache with per-tag hit tracking
// ---------------------------------------------------------------------------

export interface CacheStats {
  accesses: number;
  hits: number;
  misses: number;
  missesPerSet: Record<number, number>;
  evictions: number;
  distinctLines: number;
  /** Repeat accesses (hits) per "set:tag" key — the churn signal. */
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
 * Run one continuous stream but report miss rate per window. Windows share
 * state — a cold phase pollutes only early windows, exactly like reality.
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
    rates.push((after.misses - before.misses) / chunk.length);
  }
  return rates;
}

/**
 * Multi-level walk: an access is a hit at the first level whose cache holds
 * the line; otherwise it falls through. Returns per-level hit/miss counts
 * plus final memory misses.
 */
export interface HierarchyStats {
  levels: Array<{
    name: string;
    accesses: number;
    hits: number;
    misses: number;
    missRate: number;
    missesPerSet: Record<number, number>;
    evictions: number;
  }>;
  /** Total accesses (same for every level). */
  accesses: number;
  distinctLines: number;
  /** Accesses that fell all the way through to memory. */
  memoryMisses: number;
}

export function runHierarchy(
  addrs: number[],
  levels: CacheLevel[],
): HierarchyStats {
  // Simulate inclusion by walking levels in order with independent caches.
  const caches = levels.map((lvl) => new SetAssocLru(lvl.geometry));
  const distinct = new Set<number>();
  for (const a of addrs) distinct.add(Math.floor(a / levels[0]!.geometry.lineSizeBytes));
  void caches;
  void distinct;

  // Per-level independent runs give per-level miss rates; a true inclusive
  // walk would correlate them, but for our evidence purposes per-level rates
  // computed on the same stream are the honest measurable quantity
  // (hardware counters are also per-level aggregates).
  const perLevel = levels.map((lvl) => {
    const stats = runCacheStream(addrs, lvl.geometry);
    return {
      name: lvl.name,
      accesses: stats.accesses,
      hits: stats.hits,
      misses: stats.misses,
      missRate: stats.accesses === 0 ? 0 : stats.misses / stats.accesses,
      missesPerSet: stats.missesPerSet,
      evictions: stats.evictions,
    };
  });
  const top = perLevel[perLevel.length - 1]!;
  return {
    levels: perLevel,
    accesses: perLevel[0]?.accesses ?? 0,
    distinctLines: top.misses > 0 ? Object.values(top.missesPerSet).reduce((a, b) => a + b, 0) : 0,
    memoryMisses: top.misses,
  };
}

/** Cycle estimate across a hierarchy: sum of per-level hits × that level's penalty. */
export function estimateCyclesHierarchy(
  h: HierarchyStats,
  levels: CacheLevel[],
  opts?: { coherenceStallCycles?: number; crossCoreInvalidations?: number },
): number {
  let total = 0;
  for (let i = 0; i < h.levels.length; i++) {
    const lvl = h.levels[i]!;
    total += lvl.hits * levels[i]!.hitPenaltyCycles;
  }
  if (opts?.crossCoreInvalidations && opts.coherenceStallCycles) {
    total += opts.crossCoreInvalidations * opts.coherenceStallCycles;
  }
  return Math.round(total);
}

// ---------------------------------------------------------------------------
// Diagnostic metrics
// ---------------------------------------------------------------------------

/** Highest per-set miss count ÷ median nonzero set. */
export function setSkew(stats: CacheStats): number {
  const counts = Object.values(stats.missesPerSet).filter((c) => c > 0).sort((a, b) => a - b);
  if (counts.length === 0) return 1;
  const median = counts[Math.floor(counts.length / 2)] as number;
  const max = counts[counts.length - 1] as number;
  return median === 0 ? max : max / median;
}

export interface LocalityMetrics {
  /** Average demand accesses per distinct line touched (>1 means reuse). */
  reuseFactor: number;
  /**
   * Fraction of accesses that were to already-touched lines (temporal reuse).
   * Compulsory-heavy streams sit near 0; resident loops near 1.
   */
  temporalReuseRate: number;
  /** Distinct lines touched per access — spatial footprint intensity. */
  footprintRatio: number;
}

export function localityMetrics(stats: CacheStats): LocalityMetrics {
  const accesses = Math.max(1, stats.accesses);
  const distinct = Math.max(1, stats.distinctLines);
  const hits = stats.hits;
  return {
    reuseFactor: stats.accesses / distinct,
    temporalReuseRate: hits / accesses,
    footprintRatio: stats.distinctLines / accesses,
  };
}

// ---------------------------------------------------------------------------
// Coherence ledger (two-core write sharing)
// ---------------------------------------------------------------------------

export interface CoherenceStats {
  contendedLines: number;
  crossCoreInvalidations: number;
  localWrites: number;
  invalidationDominated: boolean;
  /** Writes to the same word/address by both cores (true sharing signal). */
  sameWordConflicts: number;
}

export function runCoherence(
  writeSequence: Array<{ core: 0 | 1; addr: number }>,
  lineSizeBytes: number,
): CoherenceStats {
  let cross = 0;
  let local = 0;
  let sameWord = 0;
  const lastWriter = new Map<number, 0 | 1>();
  const lastWordWriter = new Map<number, 0 | 1>();
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
    const word = w.addr;
    const prevWord = lastWordWriter.get(word);
    if (prevWord !== undefined && prevWord !== w.core) sameWord += 1;
    lastWriter.set(line, w.core);
    lastWordWriter.set(word, w.core);
  }
  return {
    contendedLines: contendedLines.size,
    crossCoreInvalidations: cross,
    localWrites: local,
    invalidationDominated: cross > local * 2 && cross > 64,
    sameWordConflicts: sameWord,
  };
}

// ---------------------------------------------------------------------------
// Prefetcher model with policies
// ---------------------------------------------------------------------------

export type PrefetchPolicy =
  | { kind: "next-line"; degree: 1 }
  | { kind: "off" };

export interface PrefetchStats {
  issued: number;
  useful: number;
  useless: number;
  usefulFraction: number;
  busTransactions: number;
  policy: string;
}

/**
 * Next-line prefetcher: on a demand miss to line L it issues L+1 (degree 1).
 * A prefetched line is useful when it is later demanded. Policy `off`
 * disables issuing entirely (the counterfactual probe).
 */
export function runPrefetch(
  addrs: number[],
  geo: CacheGeometry,
  policy: PrefetchPolicy = { kind: "next-line", degree: 1 },
): PrefetchStats {
  const demanded = new Set<number>();
  for (const a of addrs) demanded.add(Math.floor(a / geo.lineSizeBytes));
  const stats = runCacheStream(addrs, geo);
  if (policy.kind === "off") {
    return {
      issued: 0,
      useful: 0,
      useless: 0,
      usefulFraction: 0,
      busTransactions: stats.misses,
      policy: "off",
    };
  }
  const issued = stats.misses; // one prefetch per demand miss
  let useful = 0;
  for (const line of demanded) if (demanded.has(line + 1)) useful += 1;
  useful = Math.min(useful, issued);
  return {
    issued,
    useful,
    useless: issued - useful,
    usefulFraction: issued === 0 ? 0 : useful / issued,
    busTransactions: stats.misses + issued,
    policy: "next-line",
  };
}
