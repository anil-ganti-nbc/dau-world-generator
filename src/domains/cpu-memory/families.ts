/**
 * Causal family catalogue for cpu-memory worlds.
 *
 * v0.2: 12 causal families in three signature classes. All 12 are fully
 * implemented in the simulator and appear as PLAUSIBLE HYPOTHESES. Six are
 * solver-namable as graded truths with the current probe set:
 *
 *   conflict-miss, phase-change (conflict class)
 *   compulsory-miss-surge, spatial-locality-loss (cold class)
 *   false-sharing, true-sharing (coherence class)
 *
 * temporal-locality-loss is implemented and generated as a hypothesis but
 * its "work/flush" signature (spread misses, reuse ≈1, scatter gap) is not
 * yet separable from spatial-locality-loss by the probe set; it graduates
 * to a graded truth with the planned reuse-distance histogram probe. The
 * other four (associativity-cliff, capacity-miss, prefetch-storm/starved,
 * hierarchy-mismatch) share signatures with class siblings as documented
 * per-family below.
 */

export type FamilyId =
  | "conflict-miss"
  | "associativity-cliff"
  | "capacity-miss"
  | "compulsory-miss-surge"
  | "spatial-locality-loss"
  | "temporal-locality-loss"
  | "false-sharing"
  | "true-sharing"
  | "prefetch-storm"
  | "prefetch-starved"
  | "phase-change"
  | "hierarchy-mismatch";

export type EvidenceChannel =
  | "miss-rate"
  | "set-distribution"
  | "coherence"
  | "prefetch"
  | "timeline"
  | "locality";

/** Signature classes: members share their top-level evidence signature. */
export const SIGNATURE_CLASS: Record<FamilyId, "conflict" | "cold" | "coherence"> = {
  "conflict-miss": "conflict",
  "associativity-cliff": "conflict",
  "phase-change": "conflict",
  "capacity-miss": "cold",
  "compulsory-miss-surge": "cold",
  "spatial-locality-loss": "cold",
  "temporal-locality-loss": "cold",
  "prefetch-storm": "cold",
  "prefetch-starved": "cold",
  "hierarchy-mismatch": "cold",
  "false-sharing": "coherence",
  "true-sharing": "coherence",
};

export interface FamilyDef {
  id: FamilyId;
  label: string;
  mechanism: string;
  channels: ReadonlyArray<EvidenceChannel>;
  concepts: ReadonlyArray<{ id: string; tier: number }>;
}

export const FAMILIES: readonly FamilyDef[] = [
  {
    id: "conflict-miss",
    label: "Cache set conflicts",
    mechanism:
      "The hot lines now map onto one cache set; associativity cannot hold them, so each pass evicts the line the next iteration needs.",
    channels: ["miss-rate", "set-distribution", "timeline"],
    concepts: [{ id: "cpu-cache-levels", tier: 2 }, { id: "cpu-cache-miss", tier: 2 }],
  },
  {
    id: "associativity-cliff",
    label: "Associativity cliff",
    mechanism:
      "The cycle touches exactly one more line than the set can hold; every pass evicts another line, so a tiny working set still misses every time.",
    channels: ["miss-rate", "set-distribution", "timeline"],
    concepts: [{ id: "cpu-cache-miss", tier: 2 }, { id: "cpu-cache-levels", tier: 2 }],
  },
  {
    id: "capacity-miss",
    label: "Working set exceeds cache",
    mechanism:
      "The active data now exceeds total cache size, so each sweep evicts lines still needed on the next sweep.",
    channels: ["miss-rate", "set-distribution", "timeline", "locality"],
    concepts: [{ id: "cpu-cache-levels", tier: 2 }, { id: "cpu-cache-miss", tier: 2 }],
  },
  {
    id: "compulsory-miss-surge",
    label: "Cold-data churn",
    mechanism:
      "The loop walks fresh data every pass instead of reusing anything; nearly every access is a first-touch miss even though nothing exceeds capacity.",
    channels: ["miss-rate", "locality", "timeline"],
    concepts: [{ id: "cpu-cache-miss", tier: 2 }, { id: "cpu-cache-levels", tier: 2 }],
  },
  {
    id: "spatial-locality-loss",
    label: "Spatial locality loss",
    mechanism:
      "The access pattern jumps across memory instead of walking it; every cache line is used once instead of many times, multiplying traffic without exceeding capacity.",
    channels: ["miss-rate", "locality"],
    concepts: [{ id: "cpu-cache-miss", tier: 2 }, { id: "cpu-write-policy", tier: 2 }],
  },
  {
    id: "temporal-locality-loss",
    label: "Reuse distance blow-up",
    mechanism:
      "The loop still touches the same data but the gap between reuses grew past the cache's reach, so lines are evicted before they can be reused.",
    channels: ["miss-rate", "locality", "timeline"],
    concepts: [{ id: "cpu-cache-miss", tier: 2 }, { id: "cpu-cache-levels", tier: 2 }],
  },
  {
    id: "false-sharing",
    label: "False sharing between cores",
    mechanism:
      "Two cores write different variables that share one cache line; ownership ping-pongs and every write pays a coherence transfer.",
    channels: ["coherence", "miss-rate", "timeline"],
    concepts: [{ id: "cpu-coherency", tier: 2 }, { id: "cpu-mesi", tier: 3 }],
  },
  {
    id: "true-sharing",
    label: "True sharing on hot data",
    mechanism:
      "Both cores genuinely write the same shared word; coherence transfers are inherent to the algorithm but their volume exploded with the write mix change.",
    channels: ["coherence", "miss-rate", "timeline"],
    concepts: [{ id: "cpu-coherency", tier: 2 }, { id: "cpu-mesi", tier: 3 }],
  },
  {
    id: "prefetch-storm",
    label: "Useless prefetch traffic",
    mechanism:
      "The access order defeats the next-line prefetcher; its issued lines are never demanded and crowd real misses on the bus.",
    channels: ["prefetch", "miss-rate", "locality"],
    concepts: [{ id: "cpu-prefetch", tier: 3 }],
  },
  {
    id: "prefetch-starved",
    label: "Prefetcher starved",
    mechanism:
      "The pattern changed from sequential to scattered, so the next-line prefetcher stopped issuing; demand misses that used to be hidden now land raw.",
    channels: ["prefetch", "miss-rate", "locality"],
    concepts: [{ id: "cpu-prefetch", tier: 3 }, { id: "cpu-memory-wall", tier: 2 }],
  },
  {
    id: "phase-change",
    label: "Workload phase change",
    mechanism:
      "A new phase entered the rotation mid-run; early windows behave like the old build and later windows collapse onto a different working set.",
    channels: ["timeline", "miss-rate", "set-distribution"],
    concepts: [{ id: "cpu-cache-miss", tier: 2 }, { id: "os-sched", tier: 2 }],
  },
  {
    id: "hierarchy-mismatch",
    label: "Hierarchy mismatch",
    mechanism:
      "The working set now sits just above a level boundary, so what used to be L1 hits became L2 accesses with much longer penalties.",
    channels: ["miss-rate", "timeline", "locality"],
    concepts: [{ id: "cpu-cache-levels", tier: 2 }, { id: "cpu-memory-wall", tier: 2 }],
  },
];

const BY_ID = new Map(FAMILIES.map((f) => [f.id, f]));

export function family(id: FamilyId): FamilyDef {
  const f = BY_ID.get(id);
  if (!f) throw new Error(`unknown family ${id}`);
  return f;
}

/**
 * Families the v0.2 solver can NAME uniquely when they are true. The rest
 * remain generative hypotheses but cannot yet be graded truths.
 */
export const SOLVER_SUPPORTED: ReadonlySet<FamilyId> = new Set<FamilyId>([
  "conflict-miss",
  "phase-change",
  "compulsory-miss-surge",
  "spatial-locality-loss",
  "false-sharing",
  "true-sharing",
]);

/**
 * Distractor-eligible alternatives: plausible (share ≥1 channel) AND
 * solvable-as.
 */
export function separableAlternatives(id: FamilyId): FamilyId[] {
  const self = family(id);
  return FAMILIES.filter(
    (f) =>
      f.id !== id &&
      SOLVER_SUPPORTED.has(f.id) &&
      f.channels.some((c) => self.channels.includes(c)),
  ).map((f) => f.id);
}

/** Families that share ≥1 evidence channel with `id` (excluding itself). */
export function plausibleAlternatives(id: FamilyId): FamilyId[] {
  const self = family(id);
  return FAMILIES.filter(
    (f) => f.id !== id && f.channels.some((c) => self.channels.includes(c)),
  ).map((f) => f.id);
}
