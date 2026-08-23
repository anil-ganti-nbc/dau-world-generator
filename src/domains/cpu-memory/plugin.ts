import type { DomainPlugin, CauseDescriptor, GenerateInput, GeneratedWorldContent } from "../../core/plugin";
import type { DifficultyProfile, Hypothesis, Observation, WorldAction, WorldSpec } from "../../core/types";
import type { ConceptRef } from "../../core/concepts";
import { Rng } from "../../core/rng";
import {
  DEFAULT_CYCLE_MODEL,
  estimateCycles,
  runCacheStream,
  runCacheStreamWindows,
  runCoherence,
  runPrefetch,
  hitConcentration,
  setSkew,
  type CacheGeometry,
  type CoherenceStats,
} from "./sim";

export const DOMAIN_ID = "cpu-memory";
export const DOMAIN_VERSION = "1.0.0";
export const TEMPLATE_ID = "regression-diagnosis";

const CAUSES: CauseDescriptor[] = [
  { id: "conflict-miss", label: "Cache set conflicts", mechanism: "The new layout maps the hottest lines onto one cache set; associativity cannot hold them, so every pass evicts the line the next iteration needs." },
  { id: "capacity-miss", label: "Working set exceeds cache", mechanism: "The active data now exceeds total cache size, so each sweep over it evicts lines still needed on the next sweep." },
  { id: "false-sharing", label: "False sharing between cores", mechanism: "Two cores write different variables that share one cache line; ownership ping-pongs and every write pays a coherence transfer." },
  { id: "prefetch-storm", label: "Useless prefetch traffic", mechanism: "The access order defeats the next-line prefetcher; its issued lines are never demanded and crowd real misses on the bus." },
];

/** Hidden parameters for one generated world. */
interface CpuMemoryHidden {
  geometry: CacheGeometry;
  /** Byte addresses forming the regressed loop's stream. */
  addrs: number[];
  /** The same loop as it ran in the known-good build (healthy locality). */
  benignAddrs: number[];
  /** Interleaved writer sequence (false-sharing worlds only). */
  writes?: Array<{ core: 0 | 1; addr: number }>;
  cycleModel: typeof DEFAULT_CYCLE_MODEL;
}

const CONCEPT_TIERS: Record<string, number> = {
  "cpu-cache-miss": 2,
  "cpu-cache-levels": 2,
  "cpu-write-policy": 2,
  "cpu-coherency": 2,
  "cpu-prefetch": 3,
  "cpu-mesi": 3,
};

export class CpuMemoryDomain implements DomainPlugin {
  readonly domainId = DOMAIN_ID;
  readonly version = DOMAIN_VERSION;

  causes(): CauseDescriptor[] {
    return CAUSES;
  }

  generate(input: GenerateInput): GeneratedWorldContent {
    const rng = input.rng.fork("world");
    const band = input.difficultyBand;

    const cause = rng.pick(CAUSES);
    const distractors = CAUSES.filter((c) => c.id !== cause.id);

    const geometry: CacheGeometry = {
      sizeBytes: rng.pick([16 * 1024, 32 * 1024]),
      lineSizeBytes: 64,
      associativity: rng.pick([2, 4]),
    };

    const hidden = this.buildHidden(cause.id, geometry, rng);
    const actions = this.buildActions();
    const hypotheses = this.buildHypotheses(cause.id, distractors, band, rng);
    const difficulty = this.buildDifficulty(band, hypotheses.length - 1);

    return {
      title: this.buildTitle(rng),
      briefing: this.buildBriefing(geometry, band, rng),
      concepts: this.conceptsFor(cause.id),
      prerequisiteConceptIds: ["cpu-cache-levels"],
      objective:
        "Diagnose why the hot loop regressed by inspecting counters, then commit to exactly one root cause.",
      difficulty,
      actions,
      hypotheses,
      solution: this.buildSolution(cause.id),
      hidden: { causeId: cause.id, parameters: hidden as unknown as Record<string, unknown> },
    };
  }

  // -------------------------------------------------------------------------
  // Hidden-state construction. Each cause builds an address stream whose REAL
  // simulation (sim.ts) yields a distinct evidence signature.
  // -------------------------------------------------------------------------

  private buildHidden(causeId: string, geo: CacheGeometry, rng: Rng): CpuMemoryHidden {
    const sets = Math.round(geo.sizeBytes / (geo.lineSizeBytes * geo.associativity));
    const lineBytes = geo.lineSizeBytes;
    let addrs: number[];
    let writes: Array<{ core: 0 | 1; addr: number }> | undefined;

    switch (causeId) {
      case "conflict-miss": {
        // A handful of DISTINCT hot lines mapping to ONE set (just over
        // associativity) cycled against a small resident region. Every pass
        // really evicts the next hot line -> misses pile onto one set while
        // the rest of the working set stays cached.
        const setIndex = rng.int(1, sets - 2);
        const strideWithinSet = sets * lineBytes;
        const hotLines = geo.associativity + rng.int(1, 2); // just over capacity
        const hot = Array.from({ length: hotLines }, (_, i) => setIndex * lineBytes + i * strideWithinSet);
        const residentBase = 0x50_0000;
        const residentLines = 16;
        addrs = [];
        for (let rep = 0; rep < 96; rep++) {
          for (let i = 0; i < residentLines; i++) {
            addrs.push(residentBase + i * lineBytes); // healthy region: hits after first pass
          }
          for (const h of hot) addrs.push(h); // conflicting set: misses forever
        }
        break;
      }
      case "capacity-miss": {
        // Sweep twice-as-many-lines-as-the-cache repeatedly with shifting
        // phase; misses spread across every set, no line gets reused in time.
        const totalLines = Math.floor(geo.sizeBytes / lineBytes);
        const sweepLines = totalLines * 2;
        const base = rng.int(0, 8) * 4096 + 0x10_0000;
        addrs = [];
        for (let rep = 0; rep < 6; rep++) {
          addrs.push(...Array.from({ length: sweepLines }, (_, i) => base + ((rep * 37 + i) % sweepLines) * lineBytes));
        }
        break;
      }
      case "false-sharing": {
        // Two counters in one line, written alternately by two cores. The
        // loop's own reads are small and well cached: regression is pure
        // coherence traffic.
        const lineBase = rng.int(0, 1023) * lineBytes + 0x20_0000;
        writes = [];
        for (let i = 0; i < 512; i++) {
          const core: 0 | 1 = i % 2 === 0 ? 0 : 1;
          writes.push({ core, addr: lineBase + (core === 0 ? 0 : 32) });
        }
        const readBase = 0x30_0000 + rng.int(0, 64) * lineBytes;
        addrs = [];
        for (let rep = 0; rep < 32; rep++) {
          for (let i = 0; i < 8; i++) addrs.push(readBase + i * lineBytes);
        }
        break;
      }
      default: {
        // prefetch-storm: descending walk defeats next-line prefetch; every
        // access is a distinct line, misses spread evenly across sets, no churn.
        const stride = -Math.abs(rng.pick([128, 256]));
        addrs = Array.from({ length: 1024 }, (_, i) => 0x40_0000 + i * stride);
        break;
      }
    }

    // Baseline: the same loop as the known-good build ran it — identical
    // access count, healthy locality (a small resident window).
    const benignAddrs = Array.from({ length: addrs.length }, (_, i) => 0x60_0000 + (i % 64) * lineBytes);

    return { geometry: geo, addrs, benignAddrs, writes, cycleModel: DEFAULT_CYCLE_MODEL };
  }

  private simulate(hidden: CpuMemoryHidden): {
    stats: ReturnType<typeof runCacheStream>;
    benignStats: ReturnType<typeof runCacheStream>;
    coherence: CoherenceStats | null;
    cycles: number;
    benignCycles: number;
    windows: number[];
    skew: number;
  } {
    const stats = runCacheStream(hidden.addrs, hidden.geometry);
    const benignStats = runCacheStream(hidden.benignAddrs, hidden.geometry);
    const coherence = hidden.writes ? runCoherence(hidden.writes, hidden.geometry.lineSizeBytes) : null;
    const cycles = estimateCycles(stats, coherence, null, hidden.cycleModel);
    const benignCycles = estimateCycles(benignStats, null, null, hidden.cycleModel);
    const windows = runCacheStreamWindows(hidden.addrs, hidden.geometry, 8);
    return { stats, benignStats, coherence, cycles, benignCycles, windows, skew: setSkew(stats) };
  }

  // -------------------------------------------------------------------------
  // Actions & observations
  // -------------------------------------------------------------------------

  private buildActions(): WorldAction[] {
    return [
      {
        id: "perf-counters",
        kind: "measure",
        label: "Read perf counters",
        description: "Cycle counts for the current build vs the last known-good build.",
      },
      {
        id: "cache-params",
        kind: "inspect",
        label: "Dump cache configuration",
        description: "Size, line size, associativity of the level the loop runs against.",
      },
      {
        id: "miss-timeline",
        kind: "measure",
        label: "Miss-rate timeline",
        description: "Miss rate across eight equal windows of the regression run.",
      },
      {
        id: "set-distribution",
        kind: "measure",
        label: "Line-churn analysis",
        description: "Where repeated accesses land: which lines and sets absorb the churn.",
      },
      {
        id: "coherence-probe",
        kind: "measure",
        label: "Coherence probe",
        description: "Cross-core invalidations vs local writes in the hot region.",
      },
      {
        id: "prefetch-audit",
        kind: "measure",
        label: "Prefetch audit",
        description: "Prefetches issued vs actually-used lines.",
      },
    ];
  }

  private observeAction(hidden: CpuMemoryHidden, actionId: string): Observation | null {
    const s = this.simulate(hidden);
    const missRate = s.stats.misses / Math.max(1, s.stats.accesses);
    const benignMissRate = s.benignStats.misses / Math.max(1, s.benignStats.accesses);
    const slowdown = Math.max(1, s.cycles / Math.max(1, s.benignCycles));
    const churn = hitConcentration(s.stats);

    switch (actionId) {
      case "perf-counters":
        return {
          actionId,
          summary: "Cycle estimates for the regressed build vs the known-good baseline.",
          readings: [
            { name: "baseline cycles/K accesses", value: String(Math.round((s.benignCycles / Math.max(1, hidden.benignAddrs.length)) * 1000)) },
            { name: "current cycles/K accesses", value: String(Math.round((s.cycles / Math.max(1, hidden.addrs.length)) * 1000)) },
            { name: "estimated slowdown", value: `${slowdown.toFixed(2)}x` },
          ],
        };
      case "cache-params":
        return {
          actionId,
          summary: "Effective cache geometry seen by the hot loop.",
          readings: [
            { name: "size", value: `${hidden.geometry.sizeBytes / 1024} KiB` },
            { name: "line size", value: `${hidden.geometry.lineSizeBytes} B` },
            { name: "associativity", value: `${hidden.geometry.associativity}-way` },
            { name: "sets", value: String(Math.round(hidden.geometry.sizeBytes / (hidden.geometry.lineSizeBytes * hidden.geometry.associativity))) },
          ],
        };
      case "miss-timeline": {
        const flat = s.windows.every((w) => Math.abs(w - (s.windows[0] as number)) < 0.05);
        const shape = flat ? "flat" : "bursty";
        return {
          actionId,
          summary: `Miss rate ${(missRate * 100).toFixed(1)}% now vs ${(benignMissRate * 100).toFixed(1)}% on the known-good build; profile is ${shape} across the run.`,
          readings: [
            { name: "miss rate", value: `${(missRate * 100).toFixed(1)}%` },
            { name: "baseline miss rate", value: `${(benignMissRate * 100).toFixed(1)}%` },
            { name: "shape", value: shape },
            { name: "windows", value: s.windows.map((w) => `${Math.round(w * 100)}%`).join(" ") },
          ],
        };
      }
      case "set-distribution": {
        const activeSets = Object.keys(s.stats.missesPerSet).length;
        const skew = s.skew;
        const concentrated = skew > 3;
        const spread = skew <= 1.5 && activeSets > 16;
        const verdictText = concentrated
          ? `Misses pile onto one set: the hottest set takes ${skew.toFixed(1)}x the misses of the median active set.`
          : spread
            ? `First-touch misses spread evenly across sets; almost no repeated-line churn.`
            : `Mixed pattern: max/median set skew ${skew.toFixed(1)}x across ${activeSets} active set(s).`;
        return {
          actionId,
          summary: verdictText,
          readings: [
            { name: "max/median set skew", value: `${skew.toFixed(1)}x` },
            { name: "repeat-churn concentration", value: `${churn.ratio.toFixed(1)}x` },
            { name: "hottest line set", value: churn.topTag ? churn.topTag.split(":")[0] ?? "?" : "none" },
            { name: "evictions", value: String(s.stats.evictions) },
            { name: "distinct lines", value: String(s.stats.distinctLines) },
            { name: "active sets", value: String(activeSets) },
          ],
          discriminatesAgainst: concentrated ? ["capacity-miss"] : spread ? ["conflict-miss"] : [],
        };
      }
      case "coherence-probe": {
        if (!s.coherence) {
          return {
            actionId,
            summary: "No inter-core write sharing detected anywhere near the hot region.",
            readings: [
              { name: "cross-core invalidations", value: "0" },
              { name: "local writes", value: "n/a" },
            ],
            discriminatesAgainst: ["false-sharing"],
          };
        }
        const dominated = s.coherence.invalidationDominated;
        return {
          actionId,
          summary: dominated
            ? `Invalidation traffic dominates: ${s.coherence.crossCoreInvalidations} cross-core transfers over ${s.coherence.contendedLines} contended line(s).`
            : `Coherence traffic present but minor: ${s.coherence.crossCoreInvalidations} transfers.`,
          readings: [
            { name: "cross-core invalidations", value: String(s.coherence.crossCoreInvalidations) },
            { name: "contended lines", value: String(s.coherence.contendedLines) },
            { name: "local writes", value: String(s.coherence.localWrites) },
          ],
          discriminatesAgainst: dominated ? [] : ["false-sharing"],
        };
      }
      case "prefetch-audit": {
        const pf = runPrefetch(hidden.addrs, hidden.geometry);
        const wasteful = pf.usefulFraction < 0.15 && pf.issued > 200;
        return {
          actionId,
          summary: wasteful
            ? `Prefetcher issued ${pf.issued} lines; almost none were ever demanded. Bus is crowded with dead prefetches.`
            : `Prefetcher activity unremarkable (issued ${pf.issued}, useful fraction ${(pf.usefulFraction * 100).toFixed(0)}%).`,
          readings: [
            { name: "prefetches issued", value: String(pf.issued) },
            { name: "useful fraction", value: `${(pf.usefulFraction * 100).toFixed(0)}%` },
            { name: "bus transactions", value: String(pf.busTransactions) },
          ],
          discriminatesAgainst: wasteful ? [] : ["prefetch-storm"],
        };
      }
      default:
        return null;
    }
  }

  observe(
    hidden: WorldSpec["hidden"],
    actionId: string,
    actionCount: number,
  ): Observation | null {
    void actionCount;
    return this.observeAction(hidden.parameters as unknown as CpuMemoryHidden, actionId);
  }

  // -------------------------------------------------------------------------
  // Hypotheses
  // -------------------------------------------------------------------------

  private buildHypotheses(
    trueCauseId: string,
    distractors: CauseDescriptor[],
    band: number,
    rng: Rng,
  ): Hypothesis[] {
    const mk = (c: CauseDescriptor, isTrue: boolean): Hypothesis => ({
      id: c.id,
      label: c.label,
      detail: c.mechanism,
      isTrue,
    });
    const truth = CAUSES.find((c) => c.id === trueCauseId)!;
    const list = [mk(truth, true)];
    const kept = band >= 2 ? distractors : rng.sample(distractors, 1);
    list.push(...rng.shuffled(kept).map((c) => mk(c, false)));
    return rng.shuffled(list);
  }

  // -------------------------------------------------------------------------
  // Solution model
  // -------------------------------------------------------------------------

  private buildSolution(causeId: string) {
    const paths: Record<string, string[]> = {
      "conflict-miss": ["perf-counters", "set-distribution"],
      "capacity-miss": ["perf-counters", "miss-timeline", "set-distribution"],
      "false-sharing": ["perf-counters", "coherence-probe"],
      "prefetch-storm": ["perf-counters", "set-distribution", "prefetch-audit"],
    };
    return {
      correctHypothesisId: causeId,
      discriminatingActions: paths[causeId] ?? paths["conflict-miss"]!,
      explanation: CAUSES.find((c) => c.id === causeId)?.mechanism ?? "",
    };
  }

  explain(hidden: WorldSpec["hidden"]): string {
    const h = hidden.parameters as unknown as CpuMemoryHidden;
    const cause = CAUSES.find((c) => c.id === hidden.causeId)!;
    const s = this.simulate(h);
    const detail: Record<string, string> = {
      "conflict-miss": `Simulation: ${s.stats.misses} misses over ${s.stats.accesses} accesses with ${s.stats.evictions} evictions concentrated where the churn is.`,
      "capacity-miss": `Simulation: ${s.stats.distinctLines} distinct lines touched against ${Math.round(h.geometry.sizeBytes / h.geometry.lineSizeBytes)} lines of cache; misses stay high across all windows.`,
      "false-sharing": `Simulation: ${s.coherence?.crossCoreInvalidations ?? 0} cross-core invalidation transfers from ${s.coherence?.contendedLines ?? 0} shared line(s).`,
      "prefetch-storm": `Simulation: prefetch useful fraction ${(runPrefetch(h.addrs, h.geometry).usefulFraction * 100).toFixed(0)}%.`,
    };
    return `${cause.mechanism} ${detail[cause.id] ?? ""}`;
  }

  // -------------------------------------------------------------------------
  // Independent solver: votes from observations only; null while ambiguous.
  // -------------------------------------------------------------------------

  solve(
    _spec: Pick<WorldSpec, "actions" | "hypotheses" | "briefing">,
    observations: Observation[],
  ): { hypothesisId: string } | null {
    let conflictEvidence = false;
    let falseSharingEvidence = false;
    let sawRegression = false;
    let sawSpread = false;
    let prefetchHelped = false;
    let prefetchDefeatedFlag = false;

    for (const obs of observations) {
      const get = (name: string) => obs.readings.find((r) => r.name === name)?.value ?? "";
      if (obs.actionId === "perf-counters") {
        sawRegression = parseFloat(get("estimated slowdown")) > 1.15;
      }
      if (obs.actionId === "set-distribution") {
        const skew = parseFloat(get("max/median set skew"));
        if (!Number.isNaN(skew)) {
          if (skew > 3) conflictEvidence = true;
          else if (skew <= 1.5) sawSpread = true;
        }
      }
      if (obs.actionId === "coherence-probe") {
        const cross = parseInt(get("cross-core invalidations"), 10);
        if (!Number.isNaN(cross)) {
          if (cross === 0) falseSharingEvidence = false;
          else if (cross > 64) falseSharingEvidence = true;
        }
      }
      if (obs.actionId === "prefetch-audit") {
        const frac = parseFloat(get("useful fraction")) / 100;
        const issued = parseInt(get("prefetches issued"), 10);
        if (!Number.isNaN(frac) && !Number.isNaN(issued)) {
          if (frac < 0.15 && issued > 200) prefetchDefeatedFlag = true;
          else if (frac >= 0.5 && issued > 100) prefetchHelped = true;
        }
      }
    }

    // Spread-out misses plus a helpful prefetcher means one big streaming
    // working set: capacity. Spread-out misses plus a defeated prefetcher
    // means the stride pattern itself is pathological: prefetch storm.
    // Spread-out misses plus a helpful prefetcher means one big streaming
    // working set: capacity. Spread-out misses plus a defeated prefetcher
    // means the stride pattern itself is pathological: prefetch storm.

    if (!sawRegression) return null;

    // Decision tree — mirrors how an engineer narrows the field:
    //   1. Direct coherence signal wins: heavy cross-core invalidations.
    //   2. Concentrated set skew: conflicts.
    //   3. Spread-out misses: split by whether the prefetcher is defeated
    //      (pathological stride = storm) or still working (plain capacity).
    // Ambiguity at any node means "keep digging" (null), never a guess.
    if (falseSharingEvidence) return { hypothesisId: "false-sharing" };
    if (conflictEvidence) return { hypothesisId: "conflict-miss" };
    if (sawSpread) {
      if (prefetchDefeatedFlag) return { hypothesisId: "prefetch-storm" };
      return { hypothesisId: "capacity-miss" };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Briefing & difficulty
  // -------------------------------------------------------------------------

  private buildBriefing(geo: CacheGeometry, band: number, rng: Rng): string {
    const svc = rng.pick(["ingest-loop", "rollup-worker", "index-compactor", "feature-extractor"]);
    const slowdownHint = band <= 2 ? "roughly 30-45%" : "measurably";
    return [
      `A routine profiling pass shows the hot loop of your ${svc} service has regressed ${slowdownHint} since yesterday's build.`,
      `The change list mentions a data-layout tweak and a library bump, neither of which touches this loop's code path.`,
      `The machine has a ${geo.sizeBytes / 1024} KiB, ${geo.lineSizeBytes} B-line, ${geo.associativity}-way set-associative cache where the loop lives. Nothing else changed.`,
      `You have a fixed evidence budget: each probe costs a full profiling rerun. Diagnose the single root cause and commit.`,
    ].join("\n\n");
  }

  private buildDifficulty(band: number, distractorCount: number): DifficultyProfile {
    const clampedBand = Math.min(5, Math.max(1, band)) as 1 | 2 | 3 | 4 | 5;
    return {
      band: clampedBand,
      relevantVariables: 4 + clampedBand,
      distractorHypotheses: distractorCount,
      causalDepth: Math.min(3, 1 + Math.floor(clampedBand / 2)),
      observability: clampedBand >= 4 ? 0.5 : 0.75,
      minInvestigations: 2,
    };
  }

  private conceptsFor(causeId: string): ConceptRef[] {
    const specific: Record<string, Array<[string, number]>> = {
      "conflict-miss": [["cpu-cache-levels", 2], ["cpu-cache-miss", 2]],
      "capacity-miss": [["cpu-cache-levels", 2], ["cpu-cache-miss", 2]],
      "false-sharing": [["cpu-coherency", 2], ["cpu-mesi", 3]],
      "prefetch-storm": [["cpu-prefetch", 3]],
    };
    return (specific[causeId] ?? []).map(([id, tier]) => ({ id, tier }));
  }

  private buildTitle(rng: Rng): string {
    const frames = [
      "The Loop That Got Slower Overnight",
      "Thirty Percent From Nowhere",
      "Same Code, Different Machine",
      "The Profiler Says Nothing Broke",
    ];
    return rng.pick(frames);
  }
}
