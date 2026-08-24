/**
 * Canonical World data model, v1.
 *
 * A World is a generated technical situation with an explicit hidden cause,
 * causal rules, observable evidence, learner actions, and a machine-checkable
 * solution. Everything here is deliberately domain-agnostic: the physics of a
 * cache hierarchy or a TCP stream lives inside a DomainPlugin, never here.
 */

import type { ConceptRef } from "./concepts";

/** Structured difficulty. No bare Easy/Medium/Hard labels without these. */
export interface DifficultyProfile {
  /** 1–5 overall band, derived from the dimensions below at generation time. */
  band: 1 | 2 | 3 | 4 | 5;
  /** Number of state variables that actually matter to the diagnosis. */
  relevantVariables: number;
  /** Number of plausible-but-wrong hypotheses the world keeps alive. */
  distractorHypotheses: number;
  /** Causal steps between root cause and headline symptom. */
  causalDepth: number;
  /** Fraction of truth-relevant variables directly observable (0–1). */
  observability: number;
  /** How many inspection actions a competent solver needs (estimate). */
  minInvestigations: number;
}

/** A learner-visible action on the world. */
export interface WorldAction {
  id: string;
  kind: "inspect" | "measure" | "run" | "configure";
  label: string;
  description: string;
}

/** Evidence produced by running an action against hidden state. */
export interface Observation {
  actionId: string;
  summary: string;
  /** Key/value readings; values must render as plain strings. */
  readings: Array<{ name: string; value: string }>;
  /** True when this observation should push a careful learner away from a wrong hypothesis. */
  discriminatesAgainst?: string[];
}

/**
 * A candidate explanation. Exactly one has `isTrue: true`; the rest must be
 * defensible from the opening narrative alone (that is what makes the world
 * require investigation) and refutable from evidence (that is what makes it
 * solvable).
 */
export interface Hypothesis {
  id: string;
  label: string;
  detail: string;
  isTrue: boolean;
  /**
   * True when this hypothesis shares the truth's top-level evidence
   * signature and therefore CANNOT be excluded by any probe in this world.
   * Such hypotheses are surfaced to the learner as "cannot be excluded"
   * rather than presented as silently wrong.
   */
  unrefutable?: boolean;
}

/** Machine-checkable solution contract. */
export interface SolutionModel {
  /** The true-cause hypothesis id. Must match the hypothesis flagged isTrue. */
  correctHypothesisId: string;
  /**
   * Minimum set of actions whose evidence, taken together, distinguishes the
   * true cause from every distractor. The solver walks this path; validation
   * proves the path exists and is sufficient.
   */
  discriminatingActions: string[];
  /** Canonical explanation revealed after diagnosis. */
  explanation: string;
}

/** Full generated world. This object is the teaching artifact. */
export interface WorldSpec {
  schemaVersion: 1;
  /** Stable identifier: `${domainId}/${templateId}` of the generating template. */
  templateId: string;
  /** Human title, may vary per generation. */
  title: string;
  domainId: string;
  /** DAU concept ids this world exercises, with tiers for provenance. */
  concepts: ConceptRef[];
  prerequisiteConceptIds: string[];
  /** Learning objective in one sentence. */
  objective: string;
  seed: string;
  difficulty: DifficultyProfile;

  /** Learner-facing situation briefing. Deliberately does not reveal cause. */
  briefing: string;

  /** Hidden ground truth. The UI must never render this object. */
  hidden: {
    causeId: string;
    /** Domain-specific hidden parameters (opaque to the core). */
    parameters: Record<string, unknown>;
  };

  /** Actions available to the learner, in presentation order. */
  actions: WorldAction[];

  /** Candidate explanations including exactly one true one. */
  hypotheses: Hypothesis[];

  solution: SolutionModel;

  /** Generation provenance. */
  meta: {
    generatedAt: string;
    domainVersion: string;
    engineVersion: string;
  };
}

/** Result returned to DAU through the Practice Labs contract. */
export interface WorldPracticeResultMetadata {
  worldTemplateId: string;
  worldSeed: string;
  correct: boolean;
  investigationsUsed: number;
  hintsUsed: number;
  firstPredictionCorrect: boolean | null;
  difficultyBand: number;
}
