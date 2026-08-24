/**
 * cpu-memory domain plugin (v2).
 *
 * 12 causal families × structural variants, geometry/policy variation,
 * multi-path investigation, operational difficulty, probe budgets.
 *
 * Laws preserved from v0.1:
 *  - all evidence derives from simulation kernels over hidden state;
 *  - the solver sees learner-visible observations only;
 *  - generate() never calls solve(); validation proves solvability.
 */

import type { DomainPlugin, CauseDescriptor, GenerateInput, GeneratedWorldContent } from "../../core/plugin";
import type { DifficultyProfile, Hypothesis, Observation, WorldAction, WorldSpec } from "../../core/types";
import { Rng } from "../../core/rng";
import { FAMILIES, family, separableAlternatives, SOLVER_SUPPORTED, SIGNATURE_CLASS, type FamilyDef, type FamilyId } from "./families";
import { VARIANTS, buildHidden } from "./construct";
import { analyze } from "./analyze";
import type { CpuMemoryHidden } from "./hidden";
import type { CacheGeometry } from "./sim";

export const DOMAIN_ID = "cpu-memory";
export const DOMAIN_VERSION = "2.0.0";
export const TEMPLATE_ID = "regression-diagnosis";

/** Evidence actions. Costs are in abstract "rerun" units (probe budget). */
interface ActionDef extends WorldAction {
  cost: number;
}

const ACTIONS: ActionDef[] = [
  { id: "perf-counters", kind: "measure", label: "Read perf counters", description: "Cycle estimates: current build vs known-good baseline.", cost: 1 },
  { id: "cache-params", kind: "inspect", label: "Dump cache configuration", description: "Size / line / associativity of each level.", cost: 0 },
  { id: "miss-timeline", kind: "measure", label: "Miss-rate timeline", description: "Miss rate across eight windows of the run.", cost: 1 },
  { id: "set-distribution", kind: "measure", label: "Set & line analysis", description: "Where misses land across sets; churn among hot lines; locality metrics.", cost: 1 },
  { id: "coherence-probe", kind: "measure", label: "Coherence probe", description: "Cross-core invalidations vs local writes; same-word conflicts.", cost: 1 },
  { id: "prefetch-audit", kind: "measure", label: "Prefetch audit", description: "Prefetches issued vs used under current policy.", cost: 1 },
  { id: "prefetch-off-run", kind: "run", label: "Rerun with prefetcher off", description: "Counterfactual: same workload, prefetching disabled.", cost: 2 },
];

const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

function toWorldAction(a: ActionDef): WorldAction {
  return { id: a.id, kind: a.kind, label: a.label, description: a.description };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// ---------------------------------------------------------------------------
// Observation synthesis
// ---------------------------------------------------------------------------

function observeAction(h: CpuMemoryHidden, actionId: string): Observation | null {
  const a = analyze(h);

  switch (actionId) {
    case "perf-counters":
      return {
        actionId,
        summary: `Cycle estimate ${a.slowdown.toFixed(2)}× the known-good baseline (${pct(a.missRate)} vs ${pct(a.benignMissRate)} L1 miss rate).`,
        readings: [
          { name: "estimated slowdown", value: `${a.slowdown.toFixed(2)}x` },
          { name: "L1 miss rate", value: pct(a.missRate) },
          { name: "baseline L1 miss rate", value: pct(a.benignMissRate) },
        ],
      };
    case "cache-params": {
      const g = h.geometry;
      const readings = [
        { name: "L1 size", value: `${g.sizeBytes / 1024} KiB` },
        { name: "line size", value: `${g.lineSizeBytes} B` },
        { name: "associativity", value: `${g.associativity}-way` },
      ];
      if (h.secondLevel) {
        readings.push(
          { name: "L2 size", value: `${h.secondLevel.sizeBytes / 1024} KiB` },
          { name: "L2 assoc", value: `${h.secondLevel.associativity}-way` },
        );
      }
      return { actionId, summary: "Effective cache configuration.", readings };
    }
    case "miss-timeline": {
      const first = a.windows[0] as number;
      const last = a.windows[a.windows.length - 1] as number;
      const flat = a.windows.every((w) => Math.abs(w - (first as number)) < 0.05);
      const shape = flat ? "flat" : last > first * 2 ? "rising" : last < first * 0.5 ? "falling" : "bursty";
      const readings: Observation["readings"] = [
        { name: "miss rate", value: pct(a.missRate) },
        { name: "shape", value: shape },
        { name: "windows %", value: a.windows.map((w) => String(Math.round(w * 100))).join(" ") },
        { name: "distinct lines touched", value: String(a.stats.distinctLines) },
      ];
      // Phase-aware windows: when phases exist, report per-window phase labels
      // and their miss rates (one shared cache across phases, like reality).
      if (h.workload.phases.length > 1 && a.phaseWindowRates.length > 0) {
        readings.push(
          { name: "phase window labels", value: a.phaseLabels.join(" ") },
          {
            name: "phase window miss %",
            value: a.phaseWindowRates.map((r) => String(Math.round(r * 100))).join(" "),
          },
        );
      }
      // A single-phase workload excludes the phase-change hypothesis; a
      // multi-phase one with distinct per-window behaviour is the
      // phase-change signature itself.
      const discriminates = h.workload.phases.length === 1 ? ["phase-change"] : undefined;
      return {
        actionId,
        summary: `L1 miss profile is ${shape}: ${a.windows.map((w) => Math.round(w * 100)).join(" ")}% per window.`,
        readings,
        discriminatesAgainst: discriminates,
      };
    }
    case "set-distribution": {
      const activeSets = Object.keys(a.stats.missesPerSet).length;
      const concentrated = a.setSkew > 3;
      const spread = a.setSkew <= 1.5 && activeSets > 16;
      const summary = concentrated
        ? `Misses concentrate on one set (${a.setSkew.toFixed(1)}× the median active set); reuse factor ${a.locality.reuseFactor.toFixed(1)}.`
        : spread
          ? `First-touch misses spread evenly across ${activeSets} sets; reuse factor ${a.locality.reuseFactor.toFixed(1)}, temporal reuse ${pct(a.locality.temporalReuseRate)}.`
          : `Mixed footprint: skew ${a.setSkew.toFixed(1)}× across ${activeSets} sets; gap pattern ${a.gapPattern}.`;
      // Concentration excludes every cold-class hypothesis (they all
      // spread misses across the cache). Any low-skew profile excludes
      // both conflict families (their whole signature is concentration).
      // The gap pattern separates the streaming families — but only at
      // the extremes: contiguous walking excludes spatial loss, scattered
      // jumping excludes churn. Short strides are ambiguous, so neither.
      const discriminatesAgainst =
        concentrated
          ? ["capacity-miss", "compulsory-miss-surge", "spatial-locality-loss", "temporal-locality-loss", "hierarchy-mismatch"]
          : (() => {
              const out = ["conflict-miss", "associativity-cliff"];
              if (a.gapPattern === "contiguous") {
                out.push("spatial-locality-loss");
              } else if (a.gapPattern === "scatter" || a.gapPattern === "long-stride") {
                out.push("compulsory-miss-surge", "capacity-miss", "hierarchy-mismatch");
              }
              return out;
            })();
      return {
        actionId,
        summary,
        readings: [
          { name: "set skew max/median", value: `${a.setSkew.toFixed(1)}x` },
          { name: "active sets", value: String(activeSets) },
          { name: "reuse factor", value: a.locality.reuseFactor.toFixed(1) },
          { name: "temporal reuse", value: pct(a.locality.temporalReuseRate) },
          { name: "footprint ratio", value: a.locality.footprintRatio.toFixed(2) },
          { name: "mean access gap (lines)", value: a.meanGapLines.toFixed(1) },
          { name: "gap pattern", value: a.gapPattern },
          { name: "evictions", value: String(a.stats.evictions) },
        ],
        discriminatesAgainst,
      };
    }
    case "coherence-probe": {
      if (!a.coherence || a.coherence.crossCoreInvalidations === 0) {
        return {
          actionId,
          summary: "No inter-core write sharing detected in this workload.",
          readings: [{ name: "cross-core invalidations", value: "0" }],
          discriminatesAgainst: ["false-sharing", "true-sharing"],
        };
      }
      const c = a.coherence;
      const trueShare = c.sameWordConflicts > c.crossCoreInvalidations * 0.8;
      return {
        actionId,
        summary: trueShare
          ? `Heavy coherence traffic on genuinely shared data: ${c.crossCoreInvalidations} transfers, ${c.sameWordConflicts} on the SAME word.`
          : `Coherence ping-pong between adjacent words: ${c.crossCoreInvalidations} transfers across ${c.contendedLines} line(s), same-word conflicts only ${c.sameWordConflicts}.`,
        readings: [
          { name: "cross-core invalidations", value: String(c.crossCoreInvalidations) },
          { name: "contended lines", value: String(c.contendedLines) },
          { name: "same-word conflicts", value: String(c.sameWordConflicts) },
          { name: "local writes", value: String(c.localWrites) },
        ],
        discriminatesAgainst: trueShare ? ["false-sharing"] : ["true-sharing"],
      };
    }
      case "prefetch-audit": {
        const pf = a.prefetchNow;
        const defeated = pf.usefulFraction < 0.35 && pf.issued > 200;
        const helpful = pf.usefulFraction >= 0.5 && pf.issued > 100;
        const quiet = pf.issued < Math.max(50, a.stats.distinctLines * 0.3);
        const summary = defeated
          ? `Prefetcher issued ${pf.issued} lines, useful fraction ${pct(pf.usefulFraction)} — bus crowded with dead prefetches.`
          : helpful
            ? `Prefetcher healthy: issued ${pf.issued}, useful fraction ${pct(pf.usefulFraction)}.`
            : quiet
              ? `Prefetcher barely issuing (${pf.issued} prefetches against ${a.stats.distinctLines} distinct lines) — pattern defeats it entirely.`
              : `Prefetcher mixed: issued ${pf.issued}, useful fraction ${pct(pf.usefulFraction)}.`;
        // Healthy prefetching excludes both prefetch pathologies; a defeated
        // one excludes "healthy capacity streaming" (capacity worlds have a
        // helpful prefetcher on contiguous sweeps). The gap pattern of the
        // defeated/quiet pattern separates churn (contiguous) from spatial
        // loss (scatter/stride).
        let discriminates: string[] | undefined;
        if (helpful) discriminates = ["prefetch-storm", "prefetch-starved"];
        else if (defeated || quiet) {
          discriminates = ["capacity-miss"];
          if (a.gapPattern === "scatter" || a.gapPattern === "long-stride") {
            discriminates.push("compulsory-miss-surge");
          } else if (a.gapPattern === "contiguous") {
            discriminates.push("spatial-locality-loss");
          }
          // Zero useful fraction with zero reuse means every line was
          // touched exactly once — the spatial-loss signature itself.
          // (Churn worlds stream contiguously and the prefetcher helps
          // them, so a defeated prefetcher on zero-reuse data excludes it.)
          if (a.locality.reuseFactor <= 1.05 && a.locality.temporalReuseRate < 0.02) {
            discriminates.push("temporal-locality-loss", "compulsory-miss-surge");
          }
        }
        // Coherence worlds (tiny resident read set) have short-stride gaps
        // and a defeated prefetcher — they must not be misread as spatial
        // loss. The coherence probe is the authority there: when cross-core
        // traffic exists, cold-class hypotheses are excluded.
        if (a.coherence && a.coherence.crossCoreInvalidations > 0) {
          discriminates = [
            ...(discriminates ?? []).filter((id) => id !== "spatial-locality-loss"),
            "compulsory-miss-surge",
            "capacity-miss",
            "spatial-locality-loss",
          ];
        }
        // Phase-change worlds: the timeline shows distinct phase windows.
        // That evidence excludes single-phase families entirely (conflict,
        // churn, spatial loss, temporal loss, capacity, coherence).
        if ((h.workload.phases.length ?? 1) > 1) {
          const before = new Set(discriminates ?? []);
          for (const id of [
            "conflict-miss",
            "compulsory-miss-surge",
            "spatial-locality-loss",
            "temporal-locality-loss",
            "capacity-miss",
            "false-sharing",
            "true-sharing",
          ]) {
            before.add(id);
          }
          discriminates = [...before];
        }
        return {
          actionId,
          summary,
          readings: [
            { name: "prefetches issued", value: String(pf.issued) },
            { name: "useful fraction", value: pct(pf.usefulFraction) },
            { name: "bus transactions", value: String(pf.busTransactions) },
          ],
          discriminatesAgainst: discriminates,
        };
      }
    case "prefetch-off-run": {
      const delta = a.prefetchOff.busTransactions - a.prefetchNow.busTransactions;
      const cyclesDelta = a.cycles - estimateCyclesOff(a);
      const verdict =
        Math.abs(cyclesDelta) < a.benignCycles * 0.05
          ? "no meaningful change — prefetching was not part of the story"
          : cyclesDelta > 0
            ? "disabling prefetch makes it WORSE: prefetching was helping"
            : "disabling prefetch makes it BETTER: prefetching was hurting";
      void delta;
      return {
        actionId,
        summary: `Counterfactual run with prefetcher off: ${verdict}.`,
        readings: [
          { name: "cycles with prefetch", value: String(a.cycles) },
          { name: "cycles without prefetch", value: String(estimateCyclesOff(a)) },
          { name: "prefetches issued now", value: String(a.prefetchNow.issued) },
          { name: "prefetches issued off", value: "0" },
        ],
      };
    }
    default:
      return null;
  }
}

/** Cycle estimate for the same workload with prefetching disabled. */
function estimateCyclesOff(
  a: ReturnType<typeof analyze>,
): number {
  // Without prefetch, every demand miss pays full penalty.
  return Math.round(
    a.stats.misses * 120 + // CYCLE_MODEL.missPenaltyCycles
      (a.coherence ? a.coherence.crossCoreInvalidations * 90 : 0),
  );
}

function countAddrs(x: unknown): number {
  const phases = (x as { phases?: Array<{ addrs: number[]; reps: number }> }).phases ?? [];
  let n = 0;
  for (const p of phases) n += p.addrs.length * p.reps;
  return n;
}

// ---------------------------------------------------------------------------
// Plugin class
// ---------------------------------------------------------------------------

export class CpuMemoryDomain implements DomainPlugin {
  readonly domainId = DOMAIN_ID;
  readonly version = DOMAIN_VERSION;

  causes(): CauseDescriptor[] {
    return FAMILIES.map((f) => ({ id: f.id, label: f.label, mechanism: f.mechanism }));
  }

  generate(input: GenerateInput): GeneratedWorldContent {
    const band = input.difficultyBand;
    const rng = input.rng.fork("world");

    // 1. Truth family: only solver-supported families can be graded truths.
    const supported = FAMILIES.filter((f) => SOLVER_SUPPORTED.has(f.id));
    const def = rng.pick(supported) as FamilyDef;
    const variantLabel = rng.pick(VARIANTS[def.id]);

    const lineSizeBytes = rng.pick([64]);
    const geometry: CacheGeometry = {
      sizeBytes: rng.pick([16 * 1024, 32 * 1024]),
      lineSizeBytes,
      associativity: rng.pick([2, 4, 8]),
    };
    let secondLevel: CacheGeometry | undefined;
    if (def.id === "hierarchy-mismatch") {
      secondLevel = {
        sizeBytes: geometry.sizeBytes * rng.pick([4, 6]),
        lineSizeBytes,
        associativity: Math.min(16, geometry.associativity * 2),
      };
    }

    const hidden = buildHidden({ familyId: def.id, variantLabel, geometry, secondLevel, rng });

    // 1b. Honest-truth guard: a spatial-loss world whose pattern defeats
    // the prefetcher is indistinguishable from a prefetch storm with the
    // current probe set — such a world must not be a graded spatial truth.
    // Re-draw (deterministically, same seed stream) until the variant is
    // separable; the guard keeps the catalogue honest without weakening
    // validation.
    if (def.id === "spatial-locality-loss") {
      const probe = analyze(hidden);
      const pf = probe.prefetchNow;
      if (pf.usefulFraction < 0.35) {
        // fall through to a deterministic re-pick below
        const alt = FAMILIES.filter((f) => SOLVER_SUPPORTED.has(f.id) && f.id !== "spatial-locality-loss");
        const altDef = rng.pick(alt) as FamilyDef;
        const altVariant = rng.pick(VARIANTS[altDef.id]);
        const altHidden = buildHidden({
          familyId: altDef.id,
          variantLabel: altVariant,
          geometry,
          secondLevel: altDef.id === "hierarchy-mismatch" ? secondLevel : undefined,
          rng,
        });
        return this.assemble(altDef, altVariant, altHidden, geometry, secondLevel, band, rng);
      }
    }

    return this.assemble(def, variantLabel, hidden, geometry, secondLevel, band, rng);
  }

  /** Shared assembly used by generate() and the honest-truth re-pick path. */
  private assemble(
    def: FamilyDef,
    variantLabel: string,
    hidden: ReturnType<typeof buildHidden>,
    geometry: CacheGeometry,
    secondLevel: CacheGeometry | undefined,
    band: number,
    rng: Rng,
  ): GeneratedWorldContent {
    // Distractors: plausible AND evidence-separable (different signature
    // class). Same-class siblings are documented but not graded alternatives.
    const plausibleIds = separableAlternatives(def.id).filter(
      (id) => id !== "hierarchy-mismatch" || secondLevel !== undefined,
    );
    const distractorCount =
      band <= 1 ? 1 : band === 2 ? Math.min(2, plausibleIds.length) : Math.min(3, plausibleIds.length);
    const distractorDefs = rng.sample(plausibleIds, distractorCount).map((id) => family(id));

    const actions = ACTIONS.filter((act) => act.id !== "assoc-halve-run").map(toWorldAction);

    const hypotheses = this.buildHypotheses(def, distractorDefs, rng);
    const difficulty = this.buildDifficulty(band, hypotheses.length - 1, hidden, actions.length);

    return {
      title: this.buildTitle(rng),
      briefing: this.buildBriefing(hidden, geometry, secondLevel, band, rng),
      concepts: def.concepts.map((c) => ({ ...c })),
      prerequisiteConceptIds: ["cpu-cache-levels"],
      objective:
        "Diagnose why the hot loop regressed by inspecting counters and running counterfactuals, then commit to exactly one root cause.",
      difficulty,
      actions,
      hypotheses,
      solution: this.buildSolution(def.id),
      hidden: { causeId: def.id, parameters: hidden as unknown as Record<string, unknown> },
    };
  }

  observe(specHidden: WorldSpec["hidden"], actionId: string, actionCount: number): Observation | null {
    void actionCount;
    return observeAction(specHidden.parameters as unknown as CpuMemoryHidden, actionId);
  }

  /**
   * Independent solver. Reads ONLY observation readings; conservative:
   * returns null while key discriminations are missing.
   */
  solve(
    _spec: Pick<WorldSpec, "actions" | "hypotheses" | "briefing">,
    observations: Observation[],
  ): { hypothesisId: string } | null {
    const S = {
      regression: false,
      skewHigh: false,
      spreadMisses: false,      // skew <= 1.5 across many sets
      lowReuse: false,          // reuse factor <= 2
      deadPrefetch: false,
      helpfulPrefetch: false,
      quietPrefetch: false,
      coherenceTrueShare: false,
      coherenceFalseShare: false,
      timelineShape: "",
      phaseCount: 0,            // distinct phase labels seen in timeline evidence
      gapPattern: "",
      footprintRatio: 0,
    };

    for (const obs of observations) {
      const num = (name: string) => parseFloat(obs.readings.find((r) => r.name === name)?.value ?? "");
      switch (obs.actionId) {
        case "perf-counters":
          S.regression = num("estimated slowdown") > 1.15;
          break;
        case "set-distribution": {
          const skew = num("set skew max/median");
          const reuse = num("reuse factor");
          S.gapPattern = obs.readings.find((r) => r.name === "gap pattern")?.value ?? "";
          S.footprintRatio = num("footprint ratio");
          if (!Number.isNaN(skew)) {
            if (skew > 3) S.skewHigh = true;
            else if (skew <= 1.5) S.spreadMisses = true;
          }
          if (!Number.isNaN(reuse)) S.lowReuse = reuse <= 2.5;
          break;
        }
        case "coherence-probe": {
          const cross = parseInt(obs.readings.find((r) => r.name === "cross-core invalidations")?.value ?? "0", 10);
          if (cross > 64) {
            const sameWord = parseInt(obs.readings.find((r) => r.name === "same-word conflicts")?.value ?? "0", 10);
            S.coherenceTrueShare = sameWord > cross * 0.8;
            S.coherenceFalseShare = !S.coherenceTrueShare;
          }
          break;
        }
        case "prefetch-audit": {
          const frac = parseFloat((obs.readings.find((r) => r.name === "useful fraction")?.value ?? "0%").replace("%", "")) / 100;
          const issued = parseInt(obs.readings.find((r) => r.name === "prefetches issued")?.value ?? "0", 10);
          if (issued < 50) {
            S.quietPrefetch = true;
          } else if (frac >= 0.5 && issued > 100) {
            S.helpfulPrefetch = true;
          } else if (frac < 0.4) {
            S.deadPrefetch = true;
          }
          break;
        }
        case "miss-timeline": {
          S.timelineShape = obs.readings.find((r) => r.name === "shape")?.value ?? "";
          const labels = obs.readings.find((r) => r.name === "phase window labels")?.value;
          if (labels && labels.trim().length > 0) {
            const parts = labels.split(" ").filter(Boolean);
            S.phaseCount = new Set(parts).size;
          }
          break;
        }
      }
    }

    if (!S.regression) return null;

    // Phase-change worlds: the timeline shows a multi-phase profile. When
    // the phase evidence is present AND the miss profile is not flat, that
    // is the phase-change signature — it outranks class-level naming
    // because the timeline directly contradicts every single-phase story.
    // (Skew may be low or high depending on what the new phase touches.)
    if (S.phaseCount > 1 && S.timelineShape !== "flat") {
      return { hypothesisId: "phase-change" };
    }

    // Coherence class: same-word share separates true from false sharing.
    if (S.coherenceTrueShare) return { hypothesisId: "true-sharing" };
    if (S.coherenceFalseShare) return { hypothesisId: "false-sharing" };

    // Conflict class.
    if (S.skewHigh) {
      if (S.phaseCount > 1) return { hypothesisId: "phase-change" };
      return { hypothesisId: "conflict-miss" };
    }

    // Cold class: name the pattern-level cause the evidence supports.
    // The prefetch audit's healthy reading is a property of the pattern;
    // when prefetching IS defeated, storm/starved become the named causes
    // (they are the only cold families whose mechanism *is* the prefetch
    // failure). Otherwise reuse + gap structure name spatial/cold churn.
    if (S.spreadMisses) {
      if (S.gapPattern === "scatter" || S.gapPattern === "long-stride") {
        // Lines touched once, far apart: poor spatial locality family.
        if (S.deadPrefetch) return { hypothesisId: "prefetch-storm" };
        if (S.quietPrefetch) return { hypothesisId: "prefetch-starved" };
        return { hypothesisId: "spatial-locality-loss" };
      }
      if (S.lowReuse) {
        // Short-stride or contiguous with no reuse: spatial loss for
        // non-unit strides; contiguous + defeated prefetch also means
        // every line touched once (spatial loss); churn worlds get
        // prefetcher help on their contiguous walks.
        if (S.gapPattern === "contiguous") {
          if (S.deadPrefetch || S.quietPrefetch) return { hypothesisId: "spatial-locality-loss" };
          return { hypothesisId: "compulsory-miss-surge" };
        }
        return { hypothesisId: "spatial-locality-loss" };
      }
      // Reuse present but ineffective: reuse distance exceeded cache.
      return { hypothesisId: "temporal-locality-loss" };
    }
    void S.footprintRatio;
    void S.timelineShape;
    void S.helpfulPrefetch;
    void S.deadPrefetch;
    void S.quietPrefetch;
    return null;
  }

  explain(specHidden: WorldSpec["hidden"]): string {
    const h = specHidden.parameters as unknown as CpuMemoryHidden;
    const def = FAMILIES.find((f) => f.id === specHidden.causeId)!;
    const a = analyze(h);
    const bits: string[] = [def.mechanism];
    bits.push(
      `Simulated: slowdown ${a.slowdown.toFixed(2)}×, L1 miss rate ${pct(a.missRate)} (baseline ${pct(a.benignMissRate)}), set skew ${a.setSkew.toFixed(1)}×, reuse factor ${a.locality.reuseFactor.toFixed(1)}, gap pattern ${a.gapPattern}.`,
    );
    if (a.coherence && a.coherence.crossCoreInvalidations > 0) {
      bits.push(`Coherence: ${a.coherence.crossCoreInvalidations} cross-core transfers, ${a.coherence.sameWordConflicts} same-word.`);
    }
    bits.push(`Prefetch: issued ${a.prefetchNow.issued}, useful ${pct(a.prefetchNow.usefulFraction)}.`);
    if (a.hierarchy) {
      bits.push(`Hierarchy: L1 miss rate ${pct(a.hierarchy.l1MissRate)}, L2 miss rate ${pct(a.hierarchy.l2MissRate)}.`);
    }
    if (h.workload.phases.length > 1) {
      bits.push(`Workload has ${h.workload.phases.length} phases: ${h.workload.phases.map((p) => p.label).join(" → ")}.`);
    }
    return bits.join(" ");
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private buildHypotheses(truth: FamilyDef, distractors: FamilyDef[], rng: Rng): Hypothesis[] {
    const mk = (f: FamilyDef, isTrue: boolean): Hypothesis => {
      const h: Hypothesis = { id: f.id, label: f.label, detail: f.mechanism, isTrue };
      return h;
    };
    const list = [mk(truth, true)];
    for (const d of rng.shuffled(distractors)) list.push(mk(d, false));
    return rng.shuffled(list);
  }

  private buildDifficulty(band: number, distractorCount: number, h: CpuMemoryHidden, actionCount: number): DifficultyProfile {
    const b = Math.min(5, Math.max(1, Math.round(band))) as 1 | 2 | 3 | 4 | 5;
    const phaseCount = h.workload.phases.length;
    return {
      band: b,
      relevantVariables: 3 + distractorCount + phaseCount,
      distractorHypotheses: distractorCount,
      causalDepth: Math.min(3, 1 + Math.floor(b / 2)),
      observability: Math.max(0.35, 0.85 - b * 0.08),
      minInvestigations: Math.min(actionCount - 1, 2 + (b >= 3 ? 1 : 0)),
    };
  }

  private buildBriefing(
    h: CpuMemoryHidden,
    geo: CacheGeometry,
    secondLevel: CacheGeometry | undefined,
    band: number,
    rng: Rng,
  ): string {
    const svc = rng.pick(["ingest-loop", "rollup-worker", "index-compactor", "feature-extractor"]);
    const slowdownHint = band <= 2 ? "roughly 30-45%" : "measurably";
    const levels = secondLevel
      ? `The machine exposes an ${geo.sizeBytes / 1024} KiB L1 (${geo.lineSizeBytes} B lines, ${geo.associativity}-way) backed by a ${secondLevel.sizeBytes / 1024} KiB L2 (${secondLevel.associativity}-way).`
      : `The machine has a ${geo.sizeBytes / 1024} KiB, ${geo.lineSizeBytes} B-line, ${geo.associativity}-way cache where the loop lives.`;
    const budget =
      band >= 3
        ? `Profiling reruns are expensive: you have a fixed budget of probes before you must commit.`
        : `Each probe costs a full profiling rerun. Diagnose the single root cause and commit.`;
    void h;
    return [
      `A routine profiling pass shows the hot loop of your ${svc} service has regressed ${slowdownHint} since yesterday's build.`,
      `The change list mentions a data-layout tweak and a library bump, neither of which touches this loop's code path.`,
      levels + " Nothing else changed.",
      budget,
    ].join("\n\n");
  }

  private buildSolution(familyId: FamilyId) {
    const primary: Partial<Record<FamilyId, string[]>> = {
      "conflict-miss": ["perf-counters", "set-distribution"],
      "associativity-cliff": ["perf-counters", "set-distribution"],
      "capacity-miss": ["perf-counters", "set-distribution", "prefetch-audit"],
      "compulsory-miss-surge": ["perf-counters", "set-distribution", "miss-timeline"],
      "spatial-locality-loss": ["perf-counters", "set-distribution", "prefetch-audit"],
      "temporal-locality-loss": ["perf-counters", "set-distribution", "miss-timeline"],
      "false-sharing": ["perf-counters", "coherence-probe"],
      "true-sharing": ["perf-counters", "coherence-probe"],
      "prefetch-storm": ["perf-counters", "set-distribution", "prefetch-audit"],
      "prefetch-starved": ["perf-counters", "set-distribution", "prefetch-audit"],
      "phase-change": ["perf-counters", "miss-timeline", "set-distribution"],
      "hierarchy-mismatch": ["perf-counters", "miss-timeline", "cache-params"],
    };
    return {
      correctHypothesisId: familyId,
      discriminatingActions: primary[familyId] ?? ["perf-counters", "set-distribution"],
      explanation: family(familyId).mechanism,
    };
  }

  private buildTitle(rng: Rng): string {
    return rng.pick([
      "The Loop That Got Slower Overnight",
      "Thirty Percent From Nowhere",
      "Same Code, Different Machine",
      "The Profiler Says Nothing Broke",
      "Regression With No Suspect",
    ]);
  }
}
