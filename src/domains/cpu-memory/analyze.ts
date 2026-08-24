/**
 * Evidence analysis: derives every diagnostic metric from hidden state by
 * running the kernels. Shared by observations, the independent solver's
 * inputs, explanations, and validation — one source of truth.
 *
 * Pure function of CpuMemoryHidden. No clock, no globals.
 */

import {
  localityMetrics,
  runCacheStream,
  runCacheStreamWindows,
  runCoherence,
  runPrefetch,
  setSkew,
  type CacheGeometry,
} from "./sim";
import { isCpuMemoryHidden, type CpuMemoryHidden } from "./hidden";

function flatten(h: CpuMemoryHidden): number[] {
  const out: number[] = [];
  for (const p of h.workload.phases) {
    for (let r = 0; r < p.reps; r++) out.push(...p.addrs);
  }
  return out;
}

function flattenWrites(h: CpuMemoryHidden): Array<{ core: 0 | 1; addr: number }> {
  const out: Array<{ core: 0 | 1; addr: number }> = [];
  for (const p of h.workload.phases) {
    if (!p.writes) continue;
    for (let r = 0; r < p.reps; r++) out.push(...p.writes);
  }
  return out;
}

/** Cycle model used by analyze(): base CPI + miss penalty + coherence stalls. */
export const CYCLE_MODEL = {
  baseCpi: 1,
  hitPenaltyCycles: 0,
  missPenaltyCycles: 120,
  coherenceStallCycles: 90,
};

function estimateCycles(
  stats: ReturnType<typeof runCacheStream>,
  coherence: ReturnType<typeof runCoherence> | null,
  missPenaltyCycles: number,
): number {
  let stalls = stats.misses * missPenaltyCycles;
  if (coherence) stalls += coherence.crossCoreInvalidations * CYCLE_MODEL.coherenceStallCycles;
  return Math.round(stats.accesses * CYCLE_MODEL.baseCpi + stats.hits * CYCLE_MODEL.hitPenaltyCycles + stalls);
}

function hitConcentration(stats: ReturnType<typeof runCacheStream>): { ratio: number; topTag: string | null } {
  const entries = Object.entries(stats.hotTagHits);
  if (entries.length === 0) return { ratio: 1, topTag: null };
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  const max = sorted[0]![1];
  const median =
    sorted.length >= 3 ? (sorted[Math.floor(sorted.length / 2)] as [string, number])[1] : Math.min(max, 1);
  return { ratio: max / Math.max(1, median), topTag: sorted[0]![0] };
}

/**
 * Reuse-distance-aware metrics that separate the cold class honestly:
 *
 * - `reuseFactor`      accesses per distinct line (>1 = some reuse)
 * - `temporalReuseRate` share of accesses that were hits anywhere
 * - `footprintRatio`   distinct lines per access
 * - `meanGapLines`     mean stride between consecutive accesses
 */
function locality(h: CpuMemoryHidden, stats: ReturnType<typeof runCacheStream>) {
  return localityMetrics(stats);
}

/**
 * Phase-aware window miss rates using ONE cache whose state carries across
 * phases (like reality). Windows are equal slices of the flattened stream;
 * each reports the phase label it mostly covers.
 */
function phaseWindows(h: CpuMemoryHidden, windows: number): Array<{ label: string; missRate: number }> {
  const tagged: Array<{ addr: number; label: string }> = [];
  for (const p of h.workload.phases) {
    for (let r = 0; r < p.reps; r++) {
      for (const addr of p.addrs) tagged.push({ addr, label: p.label });
    }
  }
  if (tagged.length === 0) return [];
  const geo = h.geometry;
  const L = geo.lineSizeBytes;
  const sets = Math.max(1, Math.round(geo.sizeBytes / (L * geo.associativity)));
  let cache = new Map<number, number[]>();
  const touch = (addr: number): boolean => {
    const set = Math.floor(addr / L) % sets;
    const tag = Math.floor(addr / L);
    let lines = cache.get(set);
    if (!lines) {
      lines = [];
      cache.set(set, lines);
    }
    const idx = lines.indexOf(tag);
    if (idx >= 0) {
      lines.splice(idx, 1);
      lines.push(tag);
      return true;
    }
    if (lines.length >= geo.associativity) lines.shift();
    lines.push(tag);
    return false;
  };

  const chunk = Math.ceil(tagged.length / windows);
  const out: Array<{ label: string; missRate: number }> = [];
  for (let w = 0; w < windows; w++) {
    const slice = tagged.slice(w * chunk, (w + 1) * chunk);
    if (slice.length === 0) break;
    let misses = 0;
    for (const t of slice) if (!touch(t.addr)) misses += 1;
    const counts = new Map<string, number>();
    for (const t of slice) counts.set(t.label, (counts.get(t.label) ?? 0) + 1);
    const label = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    out.push({ label, missRate: misses / slice.length });
  }
  return out;
}

export interface Analysis {
  stats: ReturnType<typeof runCacheStream>;
  benignStats: ReturnType<typeof runCacheStream>;
  windows: number[];
  cycles: number;
  benignCycles: number;
  coherence: ReturnType<typeof runCoherence> | null;
  prefetchNow: ReturnType<typeof runPrefetch>;
  prefetchOff: ReturnType<typeof runPrefetch>;
  locality: ReturnType<typeof localityMetrics>;
  meanGapLines: number;
  gapPattern: "contiguous" | "short-stride" | "long-stride" | "scatter";
  slowdown: number;
  missRate: number;
  benignMissRate: number;
  setSkew: number;
  churnRatio: number;
  phaseLabels: string[];
  phaseWindowRates: number[];
  hierarchy?: { l1MissRate: number; l2MissRate: number };
}

export function analyze(h: CpuMemoryHidden): Analysis {
  const addrs = flatten(h);

  const benignAddrs: number[] = [];
  for (const p of h.baseline.phases) {
    for (let r = 0; r < p.reps; r++) benignAddrs.push(...p.addrs);
  }

  const stats = runCacheStream(addrs, h.geometry);
  const benignStats = runCacheStream(benignAddrs, h.geometry);
  const windows = runCacheStreamWindows(addrs, h.geometry, 8);

  const writes = flattenWrites(h);
  const coherence = writes.length > 0 ? runCoherence(writes, h.geometry.lineSizeBytes) : null;

  const prefetchNow = runPrefetch(addrs, h.geometry, h.prefetchPolicy);
  const prefetchOff = runPrefetch(addrs, h.geometry, { kind: "off" });
  const loc = locality(h, stats);

  // Mean inter-access gap in LINES between consecutive accesses.
  let gapSum = 0;
  for (let i = 1; i < addrs.length; i++) {
    gapSum += Math.abs(
      Math.floor(addrs[i]! / h.geometry.lineSizeBytes) - Math.floor(addrs[i - 1]! / h.geometry.lineSizeBytes),
    );
  }
  const meanGapLines = addrs.length > 1 ? gapSum / (addrs.length - 1) : 0;
  const gapPattern: Analysis["gapPattern"] =
    meanGapLines <= 1.2 ? "contiguous" : meanGapLines <= 4 ? "short-stride" : meanGapLines <= 40 ? "long-stride" : "scatter";

  const hideFactor = Math.min(0.8, prefetchNow.usefulFraction * 0.9);
  const effectivePenalty = Math.round(CYCLE_MODEL.missPenaltyCycles * (1 - hideFactor));
  const cycles =
    estimateCycles(stats, coherence, effectivePenalty) + Math.round(prefetchNow.useless * 2);
  const benignCycles = estimateCycles(benignStats, null, CYCLE_MODEL.missPenaltyCycles);

  const phases = phaseWindows(h, 8);

  const base: Analysis = {
    stats,
    benignStats,
    windows,
    cycles,
    benignCycles,
    coherence,
    prefetchNow,
    prefetchOff,
    locality: loc,
    meanGapLines,
    gapPattern,
    slowdown: Math.max(1, cycles / Math.max(1, benignCycles)),
    missRate: stats.misses / Math.max(1, stats.accesses),
    benignMissRate: benignStats.misses / Math.max(1, benignStats.accesses),
    setSkew: setSkew(stats),
    churnRatio: hitConcentration(stats).ratio,
    phaseLabels: phases.map((p) => p.label),
    phaseWindowRates: phases.map((p) => p.missRate),
  };

  if (h.secondLevel) {
    const l2Stats = runCacheStream(addrs, h.secondLevel);
    base.hierarchy = {
      l1MissRate: base.missRate,
      l2MissRate: l2Stats.accesses === 0 ? 0 : l2Stats.misses / l2Stats.accesses,
    };
  }
  return base;
}

/** Guard for JSON round-trips. */
export function asHidden(x: unknown): CpuMemoryHidden {
  if (!isCpuMemoryHidden(x)) throw new Error("hidden state failed shape check");
  return x;
}

export type { CacheGeometry };
