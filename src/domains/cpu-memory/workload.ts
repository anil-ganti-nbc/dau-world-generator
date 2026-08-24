/**
 * Workload model: the address streams, write sequences, and phase structure
 * that hidden state is built from. Everything here is data — the kernels in
 * sim.ts interpret it.
 */

import type { Rng } from "../../core/rng";
import type { CacheGeometry } from "./sim";

/** One contiguous phase of the workload's life. */
export interface Phase {
  /** Human label used in evidence when phases differ. */
  label: string;
  /** Access stream for this phase (byte addresses). */
  addrs: number[];
  /** Interleaved write sequence (optional; false/true sharing worlds). */
  writes?: Array<{ core: 0 | 1; addr: number }>;
  /** Relative weight (repetitions of this phase). */
  reps: number;
}

/** The complete regressed workload. */
export interface Workload {
  phases: Phase[];
}

/** The known-good twin used as the comparison baseline. */
export interface Baseline {
  phases: Phase[];
  /** How the baseline is described to the learner ("yesterday's build", "single-thread run", ...). */
  description: string;
}

// ---------------------------------------------------------------------------
// Stream recipes — small composable builders used by cause construction.
// ---------------------------------------------------------------------------

export interface StreamRecipe {
  kind:
    | "sequential"        // ascending lines, healthy spatial locality
    | "descending"        // descending walk
    | "stride"            // fixed stride >= 2 lines (poor spatial locality)
    | "pointer-chase"     // scattered single lines, no two adjacent
    | "hot-set"           // N distinct lines mapping to one set, cycled
    | "resident-window"   // small region swept repeatedly (healthy temporal)
    | "overshoot-sweep";  // more distinct lines than the cache holds
  base: number;
  /** Recipe-dependent: stride in BYTES for stride/descending; lines for hot-set/resident/overshoot. */
  paramA: number;
  /** Second parameter where needed (e.g. repetitions). */
  paramB?: number;
  /** For hot-set: which set index the lines map to (derived at build time). */
  setIndex?: number;
}

/**
 * Expand a recipe into concrete byte addresses against a geometry.
 * Deterministic pure function of (recipe, geometry).
 */
export function expandRecipe(r: StreamRecipe, geo: CacheGeometry): number[] {
  const L = geo.lineSizeBytes;
  const sets = Math.round(geo.sizeBytes / (L * geo.associativity));
  switch (r.kind) {
    case "sequential":
      return Array.from({ length: r.paramA }, (_, i) => r.base + i * L);
    case "descending":
      return Array.from({ length: r.paramA }, (_, i) => r.base - i * (r.paramB ?? L));
    case "stride":
      return Array.from({ length: r.paramA }, (_, i) => r.base + i * (r.paramB ?? 2 * L));
    case "pointer-chase": {
      // scattered distinct cache lines, never adjacent: poor spatial locality
      const out: number[] = [];
      let a = r.base;
      for (let i = 0; i < r.paramA; i++) {
        out.push(a);
        a += L * (1 + ((a >> 6) % 5)) + L; // deterministic pseudo-scatter, line-aligned
      }
      return out.map((x) => x - (x % L));
    }
    case "hot-set": {
      const n = r.paramA;
      const s = r.setIndex ?? 0;
      const strideWithinSet = sets * L;
      return Array.from({ length: n }, (_, i) => s * L + i * strideWithinSet);
    }
    case "resident-window": {
      const n = r.paramA;
      const reps = r.paramB ?? 8;
      const window = Array.from({ length: n }, (_, i) => r.base + i * L);
      const out: number[] = [];
      for (let rep = 0; rep < reps; rep++) out.push(...window);
      return out;
    }
    case "overshoot-sweep": {
      // paramA distinct lines (> capacity), possibly multi-pass with shift
      const passes = r.paramB ?? 1;
      const totalLines = Math.round(geo.sizeBytes / L);
      void sets;
      const out: number[] = [];
      for (let p = 0; p < passes; p++) {
        for (let i = 0; i < r.paramA; i++) {
          out.push(r.base + (((i + p * 37) % r.paramA) | 0) * L);
        }
      }
      void totalLines;
      return out;
    }
  }
}

/** Interleaved alternating-writer sequence over `lines` distinct lines. */
export function alternatingWriters(
  rng: Rng,
  opts: { lines: number; writes: number; cores: 2; base?: number },
): Array<{ core: 0 | 1; addr: number }> {
  const seq: Array<{ core: 0 | 1; addr: number }> = [];
  const bases = Array.from({ length: opts.lines }, (_, i) => (opts.base ?? 0x20_0000) + i * 64);
  let core: 0 | 1 = rng.chance(0.5) ? 0 : 1;
  for (let i = 0; i < opts.writes; i++) {
    seq.push({ core, addr: bases[i % opts.lines]! });
    core = core === 0 ? 1 : 0; // strictly alternate -> maximal ping-pong
  }
  return seq;
}
