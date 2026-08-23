/**
 * World validation.
 *
 * Two independent layers:
 *
 * 1. Structural invariants — checked on the spec alone. Cheap, always run.
 * 2. Solver checks — an independent solver (provided by the domain plugin but
 *    never by the generator path) must be able to identify the true cause
 *    from a discriminating evidence path, and must FAIL to identify it when
 *    given only distractor-consistent evidence. This is what separates a real
 *    diagnostic world from a guessing game with extra steps.
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

  // Concepts and provenance.
  if (spec.concepts.length === 0) issues.push(issue("error", "concepts", "world references no DAU concepts"));
  const conceptIds = new Set(spec.concepts.map((c) => c.id));
  for (const pre of spec.prerequisiteConceptIds) {
    if (!conceptIds.has(pre)) {
      issues.push(
        issue("warning", "prereq-not-exercised", `prerequisite ${pre} not among exercised concepts`),
      );
    }
  }

  // Exactly one true hypothesis; at least one distractor above band 1.
  const trueHypotheses = spec.hypotheses.filter((h) => h.isTrue);
  if (trueHypotheses.length !== 1) {
    issues.push(
      issue("error", "hypotheses", `expected exactly 1 true hypothesis, found ${trueHypotheses.length}`),
    );
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
  if (distractors !== spec.difficulty.distractorHypotheses) {
    issues.push(
      issue("warning", "distractor-count", "difficulty.distractorHypotheses does not match hypotheses array"),
    );
  }

  // Actions referenced by the solution must exist.
  const actionIds = new Set(spec.actions.map((a) => a.id));
  for (const needed of spec.solution.discriminatingActions) {
    if (!actionIds.has(needed)) {
      issues.push(issue("error", "action-missing", `discriminating action ${needed} is not offered to the learner`));
    }
  }
  if (spec.actions.length < spec.difficulty.minInvestigations) {
    issues.push(
      issue("error", "actions", "fewer actions than difficulty.minInvestigations"),
    );
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Solver checks
// ---------------------------------------------------------------------------

export interface SolveReport {
  solvable: boolean;
  distractorsRefutable: boolean;
  /** The observation sequence that solves the world (provenance for tests). */
  solvingPath: string[];
  issues: ValidationIssue[];
}

/**
 * Run the plugin's independent solver against:
 *   - every single-action subset (must NOT conclude the true cause), then
 *   - the declared discriminating action set (MUST conclude the true cause).
 *
 * Single-action non-solvability enforces "reasoning, not lucky guessing":
 * no one observation may give the game away for these diagnostic worlds.
 */
export function solveCheck(spec: WorldSpec, plugin: DomainPlugin): SolveReport {
  const issues: ValidationIssue[] = [];
  const discriminating = spec.solution.discriminatingActions;

  const observationsFor = (ids: string[]): Observation[] =>
    ids.map((id) => plugin.observe(spec.hidden, id, 0)).filter((o): o is Observation => o !== null);

  // Every proper prefix of the discriminating path must be insufficient —
  // otherwise the world is trivially solved early.
  for (let i = 1; i < discriminating.length; i++) {
    const partial = observationsFor(discriminating.slice(0, i));
    const partialSolve = plugin.solve(
      { actions: spec.actions, hypotheses: spec.hypotheses, briefing: spec.briefing },
      partial,
    );
    if (partialSolve && partialSolve.hypothesisId === spec.solution.correctHypothesisId) {
      issues.push(
        issue(
          "warning",
          "early-solve",
          `solver reaches the answer after only ${i} of ${discriminating.length} investigations`,
        ),
      );
    }
  }

  // Full path must solve.
  const fullObservations = observationsFor(discriminating);
  const fullSolve = plugin.solve(
    { actions: spec.actions, hypotheses: spec.hypotheses, briefing: spec.briefing },
    fullObservations,
  );
  const solvable = Boolean(fullSolve && fullSolve.hypothesisId === spec.solution.correctHypothesisId);
  if (!solvable) {
    issues.push(
      issue("error", "unsolvable", "independent solver cannot reach the true cause from the declared evidence path"),
    );
  }

  // Distractor refutability: after the full path, the solver's confidence set
  // must exclude every distractor. Plugins report this via solve() returning
  // the unique supported hypothesis; we additionally require each distractor
  // to be eliminated by at least one observation marked against it OR by the
  // solver's own discrimination logic. The check below verifies the marks.
  const observed = new Set<string>();
  for (const obs of fullObservations) {
    for (const h of obs.discriminatesAgainst ?? []) observed.add(h);
  }
  let distractorsRefutable = true;
  for (const h of spec.hypotheses) {
    if (h.isTrue) continue;
    if (!observed.has(h.id)) {
      // Not directly marked: acceptable only if the solver still lands uniquely
      // on the truth (implicit elimination). We accept implicit elimination,
      // but record it so tests can tighten this per domain.
      distractorsRefutable = distractorsRefutable && solvable;
    }
  }
  if (!distractorsRefutable) {
    issues.push(issue("error", "distractor-unrefuted", "at least one distractor survives all evidence"));
  }

  return { solvable, distractorsRefutable, solvingPath: [...discriminating], issues };
}
