/**
 * Cause construction: builds hidden state per (family, variant, geometry).
 *
 * Each recipe constructs address streams whose REAL simulation yields the
 * claimed symptom class. Variants within a family change the structure
 * (stream shape, phase layout, write pattern), not just parameters — two
 * seeds of the same family can require different reasoning.
 */

import type { Rng } from "../../core/rng";
import type { CacheGeometry } from "./sim";
import type { CpuMemoryHidden } from "./hidden";
import { alternatingWriters, expandRecipe, type Phase, type Workload, type Baseline } from "./workload";
import type { FamilyId } from "./families";

export interface BuildInput {
  familyId: FamilyId;
  variantLabel: string;
  geometry: CacheGeometry;
  secondLevel?: CacheGeometry;
  rng: Rng;
}

/** Distinct structural variants per family. Each is a different mechanism instance. */
export const VARIANTS: Record<FamilyId, string[]> = {
  "conflict-miss": ["hot-array", "strided-collision", "struct-padding"],
  "associativity-cliff": ["one-over", "two-over"],
  "capacity-miss": ["sweep-growth", "multi-buffer"],
  "compulsory-miss-surge": ["fresh-inputs", "rotating-buffers"],
  "spatial-locality-loss": ["gather-scatter", "column-walk"],
  "temporal-locality-loss": ["pass-split", "interleaved-streams"],
  "false-sharing": ["adjacent-counters", "split-struct"],
  "true-sharing": ["shared-accumulator", "hot-lock-data"],
  "prefetch-storm": ["descending-stride", "wide-stride"],
  "prefetch-starved": ["pointer-chase", "random-touch"],
  "phase-change": ["late-phase-entry", "mid-run-shift"],
  "hierarchy-mismatch": ["l1-spill", "l2-boundary"],
};

export function buildHidden(input: BuildInput): CpuMemoryHidden {
  const { familyId, variantLabel, geometry, secondLevel, rng } = input;
  const L = geometry.lineSizeBytes;

  // Baseline twin: healthy resident window of the same access volume.
  const baselinePhases: Phase[] = [];
  let baselineTotal = 0; // filled after workload build

  let phases: Phase[] = [];

  switch (`${familyId}/${variantLabel}`) {
    case "conflict-miss/hot-array": {
      const sets = Math.round(geometry.sizeBytes / (L * geometry.associativity));
      const setIndex = rng.int(1, sets - 2);
      const hotLines = geometry.associativity + rng.int(1, 2);
      const hot = expandRecipe({ kind: "hot-set", base: setIndex * L, paramA: hotLines, setIndex }, geometry);
      phases = [{ label: "main", addrs: cycleWithResident(hot, residentWindow(rng), 96), reps: 1 }];
      break;
    }
    case "conflict-miss/strided-collision": {
      // stride chosen so most accesses collide into few sets. The drift
      // term is a multiple of sets*L so every access still lands on the
      // SAME set (drifting by one line would spread across sets). The
      // resident window keeps baseline hits low; the hot set cycles enough
      // passes per drift block that misses dominate.
      const sets = Math.round(geometry.sizeBytes / (L * geometry.associativity));
      const setIndex = rng.int(0, sets - 1);
      const strideWithinSet = sets * L;
      // Visit every offset exactly once per pass: i -> i covers all
      // `touches` distinct tags (a stride multiplier can collapse to a
      // subset when gcd(k,touches) > 1 — e.g. (i*3)%6 visits only {0,3}).
      const touches = geometry.associativity + rng.int(2, 4);
      const stream: number[] = [];
      const driftBlocks = 8;
      for (let block = 0; block < driftBlocks; block++) {
        const drift = block * touches * strideWithinSet; // new tags, same set
        for (let rep = 0; rep < 16; rep++) {
          for (let i = 0; i < touches; i++) {
            stream.push(setIndex * L + i * strideWithinSet + drift);
          }
          for (let r = 0; r < Math.max(4, Math.floor(touches / 2)); r++) {
            stream.push(0x50_0000 + r * L); // small resident window: always hits
          }
        }
      }
      phases = [{ label: "main", addrs: stream, reps: 1 }];
      break;
    }
    case "conflict-miss/struct-padding": {
      // Two arrays, same index pattern, offset so both land in ONE set:
      // 2n hot lines in a set that holds `associativity`, cycled with a
      // resident region so the conflicts repeat every pass.
      const sets = Math.round(geometry.sizeBytes / (L * geometry.associativity));
      const setIndex = rng.int(1, sets - 2);
      const strideWithinSet = sets * L;
      const n = Math.max(3, geometry.associativity - 1);
      const resident = expandRecipe({ kind: "resident-window", base: 0x50_0000, paramA: 16, paramB: 1 }, { sizeBytes: 32 * 1024, lineSizeBytes: L, associativity: 4 });
      void resident;
      const stream: number[] = [];
      for (let rep = 0; rep < 96; rep++) {
        for (let i = 0; i < n; i++) {
          stream.push(setIndex * L + i * strideWithinSet);
          stream.push(setIndex * L + (i + n) * strideWithinSet + 0x100_0000); // far tag, same set
        }
        for (let r = 0; r < 8; r++) stream.push(0x50_0000 + ((rep * 8 + r) % 16) * L);
      }
      phases = [{ label: "main", addrs: stream, reps: 1 }];
      break;
    }
    case "associativity-cliff/one-over":
    case "associativity-cliff/two-over": {
      const over = variantLabel === "one-over" ? 1 : 2;
      const sets = Math.round(geometry.sizeBytes / (L * geometry.associativity));
      const setIndex = rng.int(1, sets - 2);
      const hot = Array.from(
        { length: geometry.associativity + over },
        (_, i) => setIndex * L + i * sets * L,
      );
      phases = [{ label: "main", addrs: cycleWithResident(hot, residentWindow(rng), 80), reps: 1 }];
      break;
    }
    case "capacity-miss/sweep-growth": {
      const totalLines = Math.round(geometry.sizeBytes / L);
      const sweep = totalLines * 2;
      phases = [
        { label: "sweep", addrs: expandRecipe({ kind: "overshoot-sweep", base: 0x10_0000, paramA: sweep, paramB: 6 }, geometry), reps: 1 },
      ];
      break;
    }
    case "capacity-miss/multi-buffer": {
      const totalLines = Math.round(geometry.sizeBytes / L);
      const buffers = rng.pick([3, 4]);
      const bufLines = Math.floor((totalLines * 1.5) / buffers);
      const stream: number[] = [];
      for (let rep = 0; rep < 6; rep++) {
        for (let b = 0; b < buffers; b++) {
          stream.push(...expandRecipe({ kind: "sequential", base: 0x10_0000 + b * 0x40_000, paramA: bufLines }, geometry));
        }
      }
      phases = [{ label: "main", addrs: stream, reps: 1 }];
      break;
    }
    case "compulsory-miss-surge/fresh-inputs": {
      // Chunk size, pass count, and base region all vary with the seed so
      // distinct seeds produce distinct streams.
      const chunk = rng.pick([96, 128, 160, 192, 224]);
      const passes = rng.pick([16, 20, 24, 28]);
      const region = rng.int(0, 7) * 0x8_0000;
      const stream: number[] = [];
      for (let p = 0; p < passes; p++) {
        stream.push(...expandRecipe({ kind: "sequential", base: 0x10_0000 + region + p * chunk * L, paramA: chunk }, geometry));
      }
      phases = [{ label: "main", addrs: stream, reps: 1 }];
      break;
    }
    case "compulsory-miss-surge/rotating-buffers": {
      const windows = rng.pick([4, 5, 6, 7, 8]);
      const winLines = Math.max(12, Math.round((geometry.sizeBytes / L) / rng.pick([3, 4, 5])));
      const stream: number[] = [];
      for (let w = 0; w < windows; w++) {
        stream.push(...expandRecipe({ kind: "sequential", base: 0x20_0000 + w * winLines * L, paramA: winLines }, geometry));
      }
      phases = [{ label: "rotation", addrs: stream, reps: 1 }];
      break;
    }
    case "spatial-locality-loss/gather-scatter": {
      phases = [
        {
          label: "main",
          addrs: expandRecipe(
            { kind: "pointer-chase", base: 0x30_0000 + rng.int(0, 15) * 0x4_0000, paramA: rng.pick([400, 500, 600, 700, 800]) },
            geometry,
          ),
          reps: 1,
        },
      ];
      break;
    }
    case "spatial-locality-loss/column-walk": {
      // column-major walk over a row-major array: stride = row width
      const rows = rng.pick([24, 32, 40, 48, 56]);
      const cols = rng.pick([48, 64, 80]);
      const stream: number[] = [];
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          stream.push(0x30_0000 + (r * cols + c) * L);
        }
      }
      phases = [{ label: "column-pass", addrs: stream, reps: 1 }];
      break;
    }
    case "temporal-locality-loss/pass-split": {
      // Work region and flush region alternate; the flush evicts the work
      // set before it can be reused. The flush is spread across ALL sets
      // (base offset per pass) so no single set concentrates misses: skew
      // stays low. Reuse factor stays > 1 because work lines are hit once
      // per pass before eviction — that >1 reuse with spread misses is the
      // temporal-loss signature the solver names.
      const lines = 48;
      // Flush sized to a fraction of cache: enough to evict the 48-line
      // work set from every set, small enough to keep total footprint
      // dominated by misses-with-partial-reuse rather than pure streaming.
      const gapLines = Math.max(lines, Math.round((geometry.sizeBytes / L) * 0.75));
      const stream: number[] = [];
      for (let rep = 0; rep < 12; rep++) {
        stream.push(...expandRecipe({ kind: "sequential", base: 0x40_0000, paramA: lines }, geometry));
        stream.push(...expandRecipe({ kind: "sequential", base: 0x60_0000 + rep * gapLines * L, paramA: gapLines }, geometry));
      }
      phases = [{ label: "work-flush-work", addrs: stream, reps: 1 }];
      break;
    }
    case "temporal-locality-loss/interleaved-streams": {
      // Two large streams interleaved: reuse exists per-stream but the
      // combined footprint exceeds cache, so lines are evicted before
      // reuse. Signature: misses spread, reuse factor > 1 (each line is
      // visited twice per pass), gap pattern scatter.
      const half = Math.round((geometry.sizeBytes / L) / rng.pick([1.6, 2, 2.4, 2.8]));
      const s1 = expandRecipe({ kind: "sequential", base: 0x40_0000, paramA: half }, geometry);
      const s2 = expandRecipe({ kind: "sequential", base: 0x50_0000 + rng.int(0, 7) * 0x8_0000, paramA: half }, geometry);
      phases = [{ label: "dual-stream", addrs: interleave(s1, s2), reps: rng.pick([3, 4, 5]) }];
      break;
    }
    case "false-sharing/adjacent-counters": {
      // Two DIFFERENT words (32B apart) on ONE line, written alternately:
      // ownership ping-pongs but writers never touch the same word.
      const lineBase = rng.int(0, 1023) * L + 0x20_0000;
      const writes: Array<{ core: 0 | 1; addr: number }> = [];
      for (let i = 0; i < 512; i++) {
        const core: 0 | 1 = i % 2 === 0 ? 0 : 1;
        writes.push({ core, addr: lineBase + (core === 0 ? 0 : Math.min(32, L / 2)) });
      }
      phases = [
        { label: "reduce", addrs: smallResident(rng), reps: 1, writes },
      ];
      break;
    }
    case "false-sharing/split-struct": {
      const lineBase = rng.int(0, 1023) * L + 0x20_0000;
      // Two hot words on ONE line (offset < line size) so ownership ping-pongs.
      const writes = Array.from({ length: 512 }, (_, i) => ({
        core: (i % 2 === 0 ? 0 : 1) as 0 | 1,
        addr: lineBase + (i % 2 === 0 ? 0 : Math.min(32, L / 2)),
      }));
      phases = [
        { label: "update", addrs: smallResident(rng), reps: 1, writes },
      ];
      break;
    }
    case "true-sharing/shared-accumulator": {
      // Both cores write THE SAME word alternately.
      const sharedAddr = 0x20_0000 + rng.int(0, 1023) * L;
      const writes: Array<{ core: 0 | 1; addr: number }> = [];
      for (let i = 0; i < 512; i++) writes.push({ core: (i % 2 === 0 ? 0 : 1) as 0 | 1, addr: sharedAddr });
      phases = [{ label: "accumulate", addrs: smallResident(rng), reps: 1, writes }];
      break;
    }
    case "true-sharing/hot-lock-data": {
      // Same line, same word, bursty writers with short solo runs.
      const sharedAddr = 0x20_0000 + rng.int(0, 1023) * L;
      const writes: Array<{ core: 0 | 1; addr: number }> = [];
      let core: 0 | 1 = 0;
      while (writes.length < 512) {
        const burst = rng.int(2, 6);
        for (let i = 0; i < burst && writes.length < 512; i++) writes.push({ core, addr: sharedAddr });
        core = core === 0 ? 1 : 0;
      }
      phases = [{ label: "critical-section", addrs: smallResident(rng), reps: 1, writes }];
      break;
    }
    case "prefetch-storm/descending-stride": {
      phases = [
        {
          label: "reverse-scan",
          addrs: expandRecipe({ kind: "descending", base: 0x40_0000 + 1024 * 256, paramA: 1024, paramB: 256 }, geometry),
          reps: 1,
        },
      ];
      break;
    }
    case "prefetch-storm/wide-stride": {
      const stride = rng.pick([512, 1024]) * L / 64 * 64; // multiple of line size, >= 512B
      phases = [
        { label: "sparse-scan", addrs: expandRecipe({ kind: "stride", base: 0x40_0000, paramA: 800, paramB: stride }, geometry), reps: 1 },
      ];
      break;
    }
    case "prefetch-starved/pointer-chase": {
      // Baseline WAS sequential (prefetcher helped); now scattered.
      phases = [
        { label: "traversal", addrs: expandRecipe({ kind: "pointer-chase", base: 0x40_0000, paramA: 700 }, geometry), reps: 1 },
      ];
      break;
    }
    case "prefetch-starved/random-touch": {
      const stream: number[] = [];
      for (let i = 0; i < 700; i++) {
        const h = (i * 2654435761) >>> 0;
        stream.push(0x40_0000 + (h % (64 * 1024)) * L);
      }
      phases = [{ label: "hash-table", addrs: dedupe(stream), reps: 1 }];
      break;
    }
    case "phase-change/late-phase-entry": {
      // Healthy resident phase first, then a collapsed hot-set phase. The
      // healthy phase must be long enough that early windows show low miss
      // rates (the "before" signal), and the collapsed set index must be
      // valid for any geometry (sets >= associativity + 2 always).
      const sets = Math.round(geometry.sizeBytes / (geometry.lineSizeBytes * geometry.associativity));
      const healthy = expandRecipe({ kind: "resident-window", base: 0x40_0000, paramA: 24, paramB: 40 }, geometry);
      const collapsed = expandRecipe(
        { kind: "hot-set", base: 0x60_0000, paramA: geometry.associativity + 2, setIndex: rng.int(1, sets - 2) },
        geometry,
      );
      phases = [
        { label: "steady-state", addrs: healthy, reps: rng.pick([1, 1, 2]) },
        { label: "new-phase", addrs: cycleWithResident(collapsed, [], 40), reps: 1 },
      ];
      break;
    }
    case "phase-change/mid-run-shift": {
      // Phase-a: a small REPEATED sweep (healthy temporal locality, low
      // miss rate). Phase-b: a long stride walk (every access a fresh
      // line, misses everywhere). The timeline contrast is the signal.
      const healthyLines = rng.pick([16, 24, 32]);
      const healthyReps = rng.pick([6, 8, 10]);
      const healthy = expandRecipe({ kind: "resident-window", base: 0x40_0000, paramA: healthyLines, paramB: healthyReps }, geometry);
      const b = expandRecipe(
        { kind: "stride", base: 0x50_0000 + rng.int(0, 7) * 0x8_0000, paramA: rng.pick([300, 400, 500]), paramB: rng.pick([3, 4, 6]) * L },
        geometry,
      );
      phases = [
        { label: "phase-a", addrs: healthy, reps: 1 },
        { label: "phase-b", addrs: b, reps: 1 },
      ];
      break;
    }
    case "hierarchy-mismatch/l1-spill": {
      // working set just above L1 but below L2; baseline fit inside L1
      if (!secondLevel) throw new Error("hierarchy-mismatch requires secondLevel");
      const l1Lines = Math.floor(geometry.sizeBytes / L);
      const ws = l1Lines + Math.ceil(l1Lines * rng.pick([0.15, 0.25]));
      const capped = Math.min(ws, Math.floor(secondLevel.sizeBytes / L) - 16);
      const baselineStream = expandRecipe({ kind: "sequential", base: 0x40_0000, paramA: l1Lines - 8 }, geometry);
      const regressed = expandRecipe({ kind: "overshoot-sweep", base: 0x40_0000, paramA: capped, paramB: 5 }, geometry);
      phases = [{ label: "grown-working-set", addrs: regressed, reps: 1 }];
      baselinePhases.push({ label: "fit-in-l1", addrs: baselineStream, reps: 1 });
      break;
    }
    case "hierarchy-mismatch/l2-boundary": {
      if (!secondLevel) throw new Error("hierarchy-mismatch requires secondLevel");
      const l2Lines = Math.floor(secondLevel.sizeBytes / L);
      const ws = l2Lines + Math.ceil(l2Lines * 0.2);
      const baselineStream = expandRecipe({ kind: "sequential", base: 0x70_0000, paramA: l2Lines - 32 }, geometry);
      const regressed = expandRecipe({ kind: "overshoot-sweep", base: 0x70_0000, paramA: ws, paramB: 4 }, geometry);
      phases = [{ label: "crossed-l2", addrs: regressed, reps: 1 }];
      baselinePhases.push({ label: "fit-in-l2", addrs: baselineStream, reps: 1 });
      break;
    }
    default:
      throw new Error(`no recipe for ${familyId}/${variantLabel}`);
  }

  if (baselinePhases.length === 0) {
    // default baseline: healthy resident-window twin sized to the main stream
    baselineTotal = phases.reduce((n, p) => n + p.addrs.length * p.reps, 0);
    baselinePhases.push({
      label: "known-good",
      addrs: expandRecipe({ kind: "resident-window", base: 0x60_0000, paramA: 32, paramB: Math.max(1, Math.ceil(baselineTotal / 32)) }, geometry),
      reps: 1,
    });
  }

  const workload: Workload = { phases };
  const baseline: Baseline = {
    phases: baselinePhases,
    description:
      familyId === "hierarchy-mismatch"
        ? "last known-good build (smaller working set)"
        : "last known-good build",
  };

  return {
    geometry,
    secondLevel,
    workload,
    baseline,
    prefetchPolicy: { kind: "next-line", degree: 1 },
    noise: { kind: "none", magnitude: 0 },
    familyId,
    variantLabel,
  };
}

// --- helpers ----------------------------------------------------------------

function residentWindow(rng: Rng): number[] {
  void rng;
  return expandRecipe({ kind: "resident-window", base: 0x50_0000, paramA: 16, paramB: 1 }, { sizeBytes: 32 * 1024, lineSizeBytes: 64, associativity: 4 });
}

function smallResident(rng: Rng): number[] {
  void rng;
  // 8-line window swept 256 times: well-cached reads accompanying the writes
  const win = Array.from({ length: 8 }, (_, i) => 0x30_0000 + i * 64);
  const out: number[] = [];
  for (let rep = 0; rep < 256; rep++) out.push(win[rep % 8]!);
  return out;
}

function cycleWithResident(hot: number[], resident: number[], passes: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < passes; p++) {
    out.push(...resident);
    out.push(...hot);
  }
  return out;
}

function interleave(a: number[], b: number[]): number[] {
  const out: number[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length) out.push(b[i]!);
  }
  return out;
}

function dedupe(addrs: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const a of addrs) {
    if (!seen.has(a)) {
      seen.add(a);
      out.push(a);
    }
  }
  return out;
}
