/**
 * Domain plugin contract.
 *
 * A DomainPlugin owns everything domain-specific: scenario templates, hidden
 * parameter generation, causal simulation, observation synthesis, hypothesis
 * construction, and its own solver. The core engine knows none of the physics.
 *
 * The contract is intentionally small. If a future domain cannot express
 * itself through these five functions, the answer is a better plugin model —
 * not special cases in the core.
 */

import type { Rng } from "./rng";
import type {
  DifficultyProfile,
  Hypothesis,
  Observation,
  SolutionModel,
  WorldAction,
  WorldSpec,
} from "./types";
import type { ConceptRef } from "./concepts";

/** One diagnosable cause inside this domain's possibility space. */
export interface CauseDescriptor {
  id: string;
  label: string;
  /** One-line mechanism summary (shown in post-diagnosis explanation). */
  mechanism: string;
}

export interface GenerateInput {
  templateId: string;
  seed: string;
  /** Requested difficulty band 1–5; plugins must honour it structurally. */
  difficultyBand: 1 | 2 | 3 | 4 | 5;
  rng: Rng;
}

export interface GeneratedWorldContent {
  title: string;
  briefing: string;
  concepts: ConceptRef[];
  prerequisiteConceptIds: string[];
  objective: string;
  difficulty: DifficultyProfile;
  actions: WorldAction[];
  hypotheses: Hypothesis[];
  solution: SolutionModel;
  /** Ground truth kept out of learner view by the engine, not by convention. */
  hidden: { causeId: string; parameters: Record<string, unknown> };
}

/**
 * The full plugin surface. `generate` builds the situation; `observe` runs a
 * learner action against hidden state; `solve` is the independent solver used
 * by validation to prove solvability without reusing generation logic.
 */
export interface DomainPlugin {
  readonly domainId: string;
  readonly version: string;

  /** Cause catalogue for this domain (drives distractor selection). */
  causes(): CauseDescriptor[];

  /**
   * Deterministically generate world content from the input.
   * Must not read wall-clock time or global mutable state.
   */
  generate(input: GenerateInput): GeneratedWorldContent;

  /**
   * Run an action against hidden state and synthesise what the learner sees.
   * Pure function of (hidden, actionId, actionCount): repeated inspection of
   * the same variable yields identical readings unless an intervening action
   * changed state (v1 domains have no state-changing actions, so observations
   * are stable). Returns null for an actionId outside this world's action set.
   */
  observe(hidden: WorldSpec["hidden"], actionId: string, actionCount: number): Observation | null;

  /**
   * Independent solver. Given only learner-visible material (briefing,
   * actions, accumulated observations), return the diagnosis it supports.
   * Validation requires solve(path) to land on the true cause for at least
   * one path, and NOT to land on the true cause when fed evidence consistent
   * with each distractor alone.
   */
  solve(
    spec: Pick<WorldSpec, "actions" | "hypotheses" | "briefing">,
    observations: Observation[],
  ): { hypothesisId: string } | null;

  /** Post-diagnosis explanation builder (canonical, from ground truth). */
  explain(hidden: WorldSpec["hidden"], correct: CauseDescriptor | undefined): string;
}
