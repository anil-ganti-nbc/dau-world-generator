/**
 * Adapter between DAU World Generator worlds and the canonical
 * dau-practice-labs contract (schemaVersion 1).
 *
 * A world session is launched as a practice request whose `parameters` carry
 * the world coordinates (domain, template, seed, difficulty). The result is
 * lightweight practice evidence only — DAU keeps mastery/SRS ownership. The
 * `metadata` map carries structured outcome fields within the 64-char key /
 * primitive value limits of the canonical result schema.
 */

import type { WorldSpec } from "../core/types";
import { sessionMetadata } from "../core/engine";

export const WORLD_LAB_ID = "world-generator";

/** Fields DAU sends inside `parameters` when launching a world session. */
export interface WorldLaunchParameters {
  domainId: string;
  templateId: string;
  seed: string;
  difficultyBand: number;
}

export function buildWorldLaunchParameters(spec: WorldSpec): WorldLaunchParameters {
  return {
    domainId: spec.domainId,
    templateId: spec.templateId.split("/")[1] ?? spec.templateId,
    seed: spec.seed,
    difficultyBand: spec.difficulty.band,
  };
}

/**
 * Structured outcome -> contract result metadata.
 *
 * Keys are short and values primitive so the payload survives the canonical
 * practiceResultSchema metadata constraints.
 */
export function worldResultMetadata(
  spec: WorldSpec,
  outcome: {
    correct: boolean;
    investigationsUsed: number;
    hintsUsed: number;
    firstPredictionCorrect: boolean | null;
  },
): Record<string, string | number | boolean | null> {
  const meta = sessionMetadata(spec, outcome);
  return {
    template: meta.worldTemplateId,
    seed: meta.worldSeed,
    correct: meta.correct,
    probes: meta.investigationsUsed,
    hints: meta.hintsUsed,
    firstPredictOk: meta.firstPredictionCorrect,
    band: meta.difficultyBand,
  };
}
