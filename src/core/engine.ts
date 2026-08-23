/**
 * World engine: assembles worlds from domain plugins and runs learner sessions.
 *
 * Generation pipeline (all deterministic from seed):
 *   templateId + seed + difficulty
 *     → domain plugin generate()      (hidden cause, hypotheses, actions)
 *     → structural validation         (invariants, one true hypothesis)
 *     → solver validation             (solvability + distractor refutability)
 *     → sealed WorldSpec
 *
 * The engine refuses to return a world that fails any check. A world that
 * cannot be solved, or that a solver can "solve" without discriminating
 * evidence, is never presented to a learner.
 */

import type { DomainPlugin } from "./plugin";
import { Rng } from "./rng";
import {
  validateWorldStructure,
  solveCheck,
  type ValidationIssue,
  type SolveReport,
} from "./validate";
import type { Hypothesis, Observation, WorldSpec } from "./types";

export const ENGINE_VERSION = "0.1.0";

export interface GenerateWorldOptions {
  domainId: string;
  templateId: string;
  seed: string;
  difficultyBand: 1 | 2 | 3 | 4 | 5;
}

/** Same as GenerateWorldOptions but accepting any number for the band (validated at runtime). */
export type GenerateWorldOptionsInput = Omit<GenerateWorldOptions, "difficultyBand"> & {
  difficultyBand: number;
};

function coerceOptions(options: GenerateWorldOptionsInput): GenerateWorldOptions {
  const band = Math.min(5, Math.max(1, Math.round(options.difficultyBand)));
  return { ...options, difficultyBand: band as 1 | 2 | 3 | 4 | 5 };
}

export class UnknownDomainError extends Error {
  constructor(domainId: string) {
    super(`Unknown domain plugin: ${domainId}`);
    this.name = "UnknownDomainError";
  }
}

export class WorldGenerationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(domainId: string, issues: ValidationIssue[]) {
    super(
      `Generated ${domainId} world failed validation: ` +
        issues.map((i) => `${i.severity}:${i.code}`).join(", "),
    );
    this.name = "WorldGenerationError";
    this.issues = issues;
  }
}

export interface RegistryEntry {
  plugin: DomainPlugin;
}

export class WorldEngine {
  private plugins = new Map<string, DomainPlugin>();

  register(plugin: DomainPlugin): void {
    if (this.plugins.has(plugin.domainId)) {
      throw new Error(`Domain already registered: ${plugin.domainId}`);
    }
    this.plugins.set(plugin.domainId, plugin);
  }

  domains(): string[] {
    return [...this.plugins.keys()];
  }

  plugin(domainId: string): DomainPlugin | undefined {
    return this.plugins.get(domainId);
  }

  /**
   * Generate + validate. Throws WorldGenerationError on any error-severity
   * issue; warnings are attached to meta but do not block.
   */
  generate(options: GenerateWorldOptionsInput): WorldSpec {
    const opts = coerceOptions(options);
    const plugin = this.plugins.get(opts.domainId);
    if (!plugin) throw new UnknownDomainError(opts.domainId);

    const rng = new Rng(`${opts.domainId}/${opts.templateId}#${opts.seed}`);
    const content = plugin.generate({
      templateId: opts.templateId,
      seed: opts.seed,
      difficultyBand: opts.difficultyBand,
      rng,
    });

    const spec: WorldSpec = {
      schemaVersion: 1,
      templateId: `${options.domainId}/${options.templateId}`,
      title: content.title,
      domainId: options.domainId,
      concepts: content.concepts,
      prerequisiteConceptIds: content.prerequisiteConceptIds,
      objective: content.objective,
      seed: options.seed,
      difficulty: content.difficulty,
      briefing: content.briefing,
      hidden: content.hidden,
      actions: content.actions,
      hypotheses: content.hypotheses,
      solution: content.solution,
      meta: {
        generatedAt: fixedTimestamp(),
        domainVersion: plugin.version,
        engineVersion: ENGINE_VERSION,
      },
    };

    const issues = validateWorldStructure(spec);
    const errors = issues.filter((i) => i.severity === "error");
    if (errors.length > 0) throw new WorldGenerationError(opts.domainId, issues);

    const solver = solveCheck(spec, plugin);
    if (!solver.solvable || !solver.distractorsRefutable) {
      throw new WorldGenerationError(
        opts.domainId,
        solver.issues,
      );
    }
    return pruneUndefined(spec);
  }

  /** True when the hypothesis id is the true one (engine-side check). */
  isCorrect(spec: WorldSpec, hypothesisId: string): boolean {
    return hypothesisId === spec.solution.correctHypothesisId;
  }

  /** Run an action through the domain plugin. */
  observe(spec: WorldSpec, actionId: string, actionCountSoFar: number): Observation | null {
    const plugin = this.plugins.get(spec.domainId);
    if (!plugin) return null;
    if (!spec.actions.some((a) => a.id === actionId)) return null;
    return plugin.observe(spec.hidden, actionId, actionCountSoFar);
  }

  /** Canonical post-diagnosis explanation from ground truth. */
  explain(spec: WorldSpec): string {
    const plugin = this.plugins.get(spec.domainId);
    if (!plugin) return "";
    return plugin.explain(spec.hidden, plugin.causes().find((c) => c.id === spec.hidden.causeId));
  }
}

/**
 * Generated worlds must be byte-reproducible, so the engine never stamps
 * wall-clock time into specs. Callers that need real timestamps record them
 * outside the WorldSpec.
 */
function fixedTimestamp(): string {
  return "generated";
}

/**
 * JSON has no `undefined`: dropping undefined-valued keys at construction
 * makes JSON.parse(JSON.stringify(spec)) a fixpoint, so specs survive the
 * trip to any UI or storage layer unchanged.
 */
function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => pruneUndefined(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = pruneUndefined(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** Convenience: build the canonical result metadata for a finished session. */
export function sessionMetadata(
  spec: WorldSpec,
  outcome: {
    correct: boolean;
    investigationsUsed: number;
    hintsUsed: number;
    firstPredictionCorrect: boolean | null;
  },
): {
  correct: boolean;
  investigationsUsed: number;
  hintsUsed: number;
  firstPredictionCorrect: boolean | null;
  difficultyBand: number;
  worldTemplateId: string;
  worldSeed: string;
} {
  return {
    ...outcome,
    difficultyBand: spec.difficulty.band,
    worldTemplateId: spec.templateId,
    worldSeed: spec.seed,
  };
}
