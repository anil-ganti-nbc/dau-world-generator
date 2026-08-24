/**
 * World validation.
 *
 * Layers:
 *  1. Structural invariants on the spec alone.
 *  2. Solver checks:
 *     - the DECLARED path must solve (solvability guarantee);
 *     - prefixes of the declared path must not solve (no early reveal);
 *     - ALTERNATIVE single-probe and probe-pair paths are explored so that
 *       worlds admitting multiple valid investigation strategies are
 *       recognised as such (multi-path support), recorded in the report.
 *
 * Refutation semantics: a distractor is refuted when an observation marks
 * it (`discriminatesAgainst`) or when the solver lands uniquely on truth.
 */

import type { DomainPlugin } from "./plugin";
import type { Hypothesis, Observation, WorldSpec } from "./types";

export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

function issue(severity: "error" | "warning", code: string, message: string): ValidationIssue {
  return { severity, code, message };
}

export function validateWorldStructure(spec: WorldSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (spec.schemaVersion !== 1) issues.push(issue("error", "schema-version", "schemaVersion must be 1"));
  if (!spec.templateId.includes("/")) {
    issues.push(issue("error", "template-id", `templateId must be domainId/templateId, got ${spec.templateId}`));
  }
  if (spec.seed.length === 0) issues.push(issue("error", "seed", "seed is empty"));

  if (spec.concepts.length === 0) issues.push(issue("error", "concepts", "world references no DAU concepts"));
  const conceptIds = new Set(spec.concepts.map((c) => c.id));
  for (const pre of spec.prerequisiteConceptIds) {
    if (!conceptIds.has(pre)) {
      issues.push(issue("warning", "prereq-not-exercised", `prerequisite ${pre} not among exercised concepts`));
    }
  }

  const trueHypotheses = spec.hypotheses.filter((h) => h.isTrue);
  if (trueHypotheses.length !== 1) {
    issues.push(issue("error", "hypotheses", `expected exactly 1 true hypothesis, found ${trueHypotheses.length}`));
  }
  const trueH = trueHypotheses[0];
  if (trueH && trueH.id !== spec.solution.correctHypothesisId) {
    issues.push(issue("error", "solution-mismatch", "solution.correctHypothesisId != flagged true hypothesis"));
  }
  const distractors = spec.hypotheses.length - trueHypotheses.length;
  if (spec.difficulty.band > 1 && distractors < 2) {
    issues.push(
      issue("error", "distractors", `difficulty ${spec.difficulty.band} needs >=2 distractor hypotheses, found ${distractors}`),
    );
  }

  const actionIds = new Set(spec.actions.map((a) => a.id));
  for (const needed of spec.solution.discriminatingActions) {
    if (!actionIds.has(needed)) {
      issues.push(issue("error", "action-missing", `discriminating action ${needed} is not offered to the learner`));
    }
  }
  if (spec.actions.length < spec.difficulty.minInvestigations + 1) {
    issues.push(issue("error", "actions", "fewer actions than difficulty.minInvestigations + baseline read"));
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Solver checks
// ---------------------------------------------------------------------------

export interface SolveReport {
  solvable: boolean;
  /** Declared-path prefix that already solves (early-reveal defect). */
  earlySolveAt: number | null;
  distractorsRefutable: boolean;
  solvingPath: string[];
  /** Number of alternative action subsets (size ≤ maxAltSize) that also solve. */
  alternativePaths: number;
  /** Example alternative paths (for fixtures/docs). */
  exampleAlternatives: string[][];
  survivingDistractors: string[];
  issues: ValidationIssue[];
}

function observationsFor(plugin: DomainPlugin, spec: WorldSpec, ids: string[]): Observation[] {
  return ids
    .map((id) => plugin.observe(spec.hidden, id, 0))
    .filter((o): o is Observation => o !== null);
}

function solvesVia(
  plugin: DomainPlugin,
  spec: WorldSpec,
  ids: string[],
): boolean {
  const verdict = plugin.solve(
    { actions: spec.actions, hypotheses: spec.hypotheses, briefing: spec.briefing },
    observationsFor(plugin, spec, ids),
  );
  return Boolean(verdict && verdict.hypothesisId === spec.solution.correctHypothesisId);
}

/** All ordered subsets of `pool` with length ≤ maxSize (order-insensitive). */
function subsets(pool: string[], maxSize: number): string[][] {
  const out: string[][] = [];
  const n = pool.length;
  const total = 1 << n;
  for (let mask = 1; mask < total; mask++) {
    const subset: string[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(pool[i]!);
    if (subset.length <= maxSize) out.push(subset);
  }
  return out;
}

export function solveCheck(spec: WorldSpec, plugin: DomainPlugin): SolveReport {
  const issues: ValidationIssue[] = [];
  const discriminating = spec.solution.discriminatingActions;

  // Prefixes of the declared path must not give the answer away.
  let earlySolveAt: number | null = null;
  for (let i = 1; i < discriminating.length; i++) {
    if (solvesVia(plugin, spec, discriminating.slice(0, i))) {
      earlySolveAt = i;
      issues.push(
        issue("warning", "early-solve", `solver reaches the answer after only ${i} of ${discriminating.length} investigations`),
      );
      break;
    }
  }

  // Declared path must solve.
  const solvable = solvesVia(plugin, spec, discriminating);
  if (!solvable) {
    issues.push(issue("error", "unsolvable", "independent solver cannot reach the true cause from the declared evidence path"));
  }

  // Multi-path discovery: any proper subset of measurable actions that also
  // solves counts as an alternative investigation strategy. Cap subset size
  // to keep this cheap (≤4 probes).
  const pool = spec.actions.map((a) => a.id).filter((id) => id !== "cache-params");
  let alternativePaths = 0;
  const exampleAlternatives: string[][] = [];
  for (const subset of subsets(pool, Math.min(4, discriminating.length + 1))) {
    const isDeclared =
      subset.length === discriminating.length &&
      [...subset].sort().join() === [...discriminating].sort().join();
    if (isDeclared) continue;
    if (solvesVia(plugin, spec, subset)) {
      alternativePaths += 1;
      if (exampleAlternatives.length < 5) exampleAlternatives.push(subset);
    }
  }

  // Refutation accounting over full learner-visible set (all actions).
  const allObservations = observationsFor(plugin, spec, spec.actions.map((a) => a.id));
  const markedAgainst = new Set<string>();
  for (const obs of allObservations) {
    for (const h of obs.discriminatesAgainst ?? []) markedAgainst.add(h);
  }
  const surviving: string[] = [];
  let undeclaredSurvivors = 0;
  for (const h of spec.hypotheses) {
    if (h.isTrue) continue;
    const refuted = markedAgainst.has(h.id);
    if (!refuted) {
      surviving.push(h.id);
      if (!h.unrefutable) undeclaredSurvivors += 1;
    }
  }
  // Surviving hypotheses must be declared unrefutable. Additionally, at
  // least one distractor MUST be refuted somewhere — a world where nothing
  // is ever excluded is not diagnostic.
  const distractorsRefutable = solvable && undeclaredSurvivors === 0 && markedAgainst.size > 0;
  if (undeclaredSurvivors > 0) {
    issues.push(
      issue(
        "error",
        "distractor-unrefuted",
        `${undeclaredSurvivors} distractor(s) survive all evidence without being declared unrefutable: ${surviving.join(", ")}`,
      ),
    );
  } else if (solvable && markedAgainst.size === 0) {
    issues.push(issue("error", "non-discriminating", "no observation excludes any hypothesis — world is not diagnostic"));
  }

  return {
    solvable,
    earlySolveAt,
    distractorsRefutable,
    solvingPath: [...discriminating],
    alternativePaths,
    exampleAlternatives,
    survivingDistractors: surviving,
    issues,
  };
}
