/**
 * Hidden state for one generated cpu-memory world.
 *
 * Everything the simulator needs: geometry, the regressed workload, its
 * known-good baseline twin, prefetch policy, and generation metadata.
 * Opaque to the core engine.
 */

import type { CacheGeometry, PrefetchPolicy } from "./sim";
import type { Workload, Baseline } from "./workload";
import type { FamilyId } from "./families";

export interface CpuMemoryHidden {
  /** Primary cache level seen by the loop. */
  geometry: CacheGeometry;
  /** Optional second level (enables hierarchy-mismatch worlds honestly). */
  secondLevel?: CacheGeometry;
  /** The regressed workload. */
  workload: Workload;
  /** Known-good comparison run + how to describe it to the learner. */
  baseline: Baseline;
  prefetchPolicy: PrefetchPolicy;
  /** Measurement noise applied at observation time (seeded). */
  noise: { kind: "none" | "sampling"; magnitude: number };
  /** Generation bookkeeping. */
  familyId: FamilyId;
  variantLabel: string;
}

/** Type guard used by observation code after JSON round-trips. */
export function isCpuMemoryHidden(x: unknown): x is CpuMemoryHidden {
  return Boolean(
    x && typeof x === "object" && "geometry" in x && "workload" in x && "baseline" in x,
  );
}
