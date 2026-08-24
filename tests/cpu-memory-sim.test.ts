/**
 * Simulator honesty tests: the models in sim.ts must behave like the real
 * phenomena they stand in for, or every world built on them is a lie.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runCacheStream,
  runCacheStreamWindows,
  runCoherence,
  runPrefetch,
  setSkew,
  setIndexOf,
  type CacheGeometry,
} from "../src/domains/cpu-memory/sim.ts";

/** Local copy of the churn metric (lives in analyze.ts for evidence code). */
function hitConcentration(stats: ReturnType<typeof runCacheStream>): { ratio: number; topTag: string | null } {
  const entries = Object.entries(stats.hotTagHits);
  if (entries.length === 0) return { ratio: 1, topTag: null };
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  const max = sorted[0]![1];
  const median = sorted.length >= 3 ? (sorted[Math.floor(sorted.length / 2)] as [string, number])[1] : Math.min(max, 1);
  return { ratio: max / Math.max(1, median), topTag: sorted[0]![0] };
}

const GEO_16K_2WAY: CacheGeometry = { sizeBytes: 16 * 1024, lineSizeBytes: 64, associativity: 2 };

describe("cache simulator", () => {
  it("sequential sweep of a small region is nearly all hits after first pass", () => {
    const addrs = Array.from({ length: 8 }, (_, i) => i * 64);
    // repeat the resident sweep many times
    const stream = Array.from({ length: 50 }, () => addrs).flat();
    const stats = runCacheStream(stream, GEO_16K_2WAY);
    assert.ok(stats.misses <= addrs.length, `expected few misses, got ${stats.misses}`);
    assert.ok(stats.hits > stats.misses * 5);
  });

  it("conflict stream really concentrates misses on one set", () => {
    // 3 distinct lines mapping to set 0 (2-way cache) cycled against a
    // resident region elsewhere.
    const sets = Math.round(GEO_16K_2WAY.sizeBytes / (GEO_16K_2WAY.lineSizeBytes * GEO_16K_2WAY.associativity));
    const strideWithinSet = sets * 64;
    const hot = [0, strideWithinSet, 2 * strideWithinSet];
    const stream: number[] = [];
    for (let rep = 0; rep < 64; rep++) {
      for (let i = 0; i < 8; i++) stream.push(0x50_0000 + i * 64);
      for (const h of hot) stream.push(h);
    }
    const stats = runCacheStream(stream, GEO_16K_2WAY);
    assert.equal(setIndexOf(hot[1]!, GEO_16K_2WAY), 0, "hot lines must map to set 0");
    assert.ok(setSkew(stats) > 10, `set skew should be extreme, got ${setSkew(stats)}`);
    assert.ok(stats.evictions >= 60, "cycling three lines through a 2-way set must evict");
  });

  it("capacity sweep spreads misses across sets with no churn", () => {
    const totalLines = Math.floor(GEO_16K_2WAY.sizeBytes / 64);
    const stream = Array.from({ length: totalLines * 2 }, (_, i) => 0x10_0000 + i * 64);
    const stats = runCacheStream(stream, GEO_16K_2WAY);
    assert.equal(stats.distinctLines, totalLines * 2);
    const hc = hitConcentration(stats);
    assert.ok(hc.ratio <= 2, "pure streaming has no repeated-line churn");
    assert.ok(Object.keys(stats.missesPerSet).length > 32, "misses spread across many sets");
  });

  it("windowed miss rates share state across windows (cold-start pollution only)", () => {
    const resident = Array.from({ length: 16 }, (_, i) => 0x50_0000 + i * 64);
    const stream = Array.from({ length: 20 }, () => resident).flat();
    const windows = runCacheStreamWindows(stream, GEO_16K_2WAY, 4);
    // First window includes cold misses; later ones are pure hits.
    assert.ok((windows[0] as number) >= 0);
    assert.ok((windows[windows.length - 1] as number) < 0.05, "late windows should be near-zero misses");
  });
});

describe("coherence ledger", () => {
  it("alternating writers on one line ping-pong ownership", () => {
    const writes = Array.from({ length: 400 }, (_, i) => ({
      core: (i % 2 === 0 ? 0 : 1) as 0 | 1,
      addr: 0x20_0000 + (i % 2 === 0 ? 0 : 32),
    }));
    const stats = runCoherence(writes, 64);
    assert.equal(stats.contendedLines, 1);
    assert.equal(stats.crossCoreInvalidations, writes.length - 1);
    assert.equal(stats.localWrites, 1);
    assert.ok(stats.invalidationDominated);
  });

  it("single-core writes produce zero invalidations", () => {
    const writes = Array.from({ length: 100 }, (_, i) => ({ core: 0 as const, addr: 0x20_0000 + i }));
    const stats = runCoherence(writes, 64);
    assert.equal(stats.crossCoreInvalidations, 0);
    assert.ok(!stats.invalidationDominated);
  });
});

describe("prefetcher", () => {
  it("ascending sequential walks make next-line prefetch useful", () => {
    const addrs = Array.from({ length: 512 }, (_, i) => 0x40_0000 + i * 64);
    const stats = runPrefetch(addrs, GEO_16K_2WAY);
    assert.ok(stats.usefulFraction > 0.9, `sequential should prefetch well, got ${stats.usefulFraction}`);
  });

  it("descending large-stride walks defeat next-line prefetch", () => {
    const addrs = Array.from({ length: 512 }, (_, i) => 0x40_0000 - i * 256);
    const stats = runPrefetch(addrs, GEO_16K_2WAY);
    assert.equal(stats.usefulFraction, 0, "descending strides never demand L+1");
    assert.equal(stats.busTransactions, stats.issued * 2, "every miss drags one dead prefetch");
  });
});
