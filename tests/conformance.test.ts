/**
 * Conformance with the canonical dau-practice-labs contract.
 *
 * These tests run against the sibling checkout of anil-ganti-nbc/dau-practice-labs
 * (the same layout CI uses: contract cloned to ../dau-practice-labs). They prove:
 *   - a world session round-trips through the canonical request schema,
 *   - the world result fits the canonical result envelope incl. metadata limits,
 *   - concept ids used by worlds match DAU curriculum id shapes.
 *
 * When the sibling is absent (standalone dev), these tests skip themselves.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONTRACT = new URL("../../dau-practice-labs/src/practice-labs/index.ts", import.meta.url);
const hasContract = existsSync(fileURLToPath(CONTRACT));

// The engine under test, always available.
import { WorldEngine } from "../src/core/engine.ts";
import { CpuMemoryDomain } from "../src/domains/cpu-memory/plugin.ts";
import {
  WORLD_LAB_ID,
  buildWorldLaunchParameters,
  worldResultMetadata,
} from "../src/adapter/practice-labs.ts";

describe("world generator core", () => {
  it("generates a valid world and keeps hidden truth sealed", () => {
    const engine = new WorldEngine();
    engine.register(new CpuMemoryDomain());
    const spec = engine.generate({
      domainId: "cpu-memory",
      templateId: "regression-diagnosis",
      seed: "conformance-1",
      difficultyBand: 3,
    });
    assert.equal(spec.schemaVersion, 1);
    assert.equal(spec.hypotheses.filter((h) => h.isTrue).length, 1);
    assert.ok(spec.concepts.length > 0, "world must reference DAU concepts");
    for (const c of spec.concepts) {
      assert.match(c.id, /^[a-z]+(-[a-z0-9]+)+$/, `concept id ${c.id} must be a DAU kebab-case id`);
    }
    // JSON round-trip must not lose anything (the UI receives JSON).
    const revived = JSON.parse(JSON.stringify(spec));
    assert.deepEqual(revived, spec);
  });

  it("is byte-reproducible from the same seed", () => {
    const engine = new WorldEngine();
    engine.register(new CpuMemoryDomain());
    const opts = {
      domainId: "cpu-memory",
      templateId: "regression-diagnosis",
      seed: "repro-42",
      difficultyBand: 2,
    };
    const a = engine.generate(opts);
    const b = engine.generate(opts);
    assert.deepEqual(a, b);
    const c = engine.generate({ ...opts, seed: "repro-43" });
    assert.notDeepEqual(a.hidden.parameters, c.hidden.parameters);
  });

  it("solves correctly across many seeds and never leaks hidden state into evidence", () => {
    const engine = new WorldEngine();
    const plugin = new CpuMemoryDomain();
    engine.register(plugin);
    let byCause: Record<string, number> = {};
    for (let i = 0; i < 60; i++) {
      const spec = engine.generate({
        domainId: "cpu-memory",
        templateId: "regression-diagnosis",
        seed: `bulk-${i}`,
        difficultyBand: 3,
      });
      byCause[spec.hidden.causeId] = (byCause[spec.hidden.causeId] ?? 0) + 1;
      // walk declared path
      const observations = spec.solution.discriminatingActions.map((id, n) =>
        engine.observe(spec, id, n),
      );
      assert.ok(observations.every((o) => o !== null), "declared path actions must all observe");
      const verdict = plugin.solve(spec, observations as never);
      assert.equal(verdict?.hypothesisId, spec.solution.correctHypothesisId, `seed bulk-${i}`);
      // briefing/actions/hypotheses must not contain the raw cause token of a wrong hypothesis
      const trueId = spec.solution.correctHypothesisId;
      for (const h of spec.hypotheses) {
        if (h.id === trueId) continue;
        assert.ok(
          !spec.briefing.toLowerCase().includes(h.label.toLowerCase()),
          "briefing must not name distractor causes",
        );
      }
    }
    // All four causes should appear across 60 seeds (uniform-ish pick).
    assert.equal(Object.keys(byCause).length, 4, `cause coverage over seeds: ${JSON.stringify(byCause)}`);
  });

  it("partial evidence paths do not solve (no lucky single probe)", () => {
    const engine = new WorldEngine();
    const plugin = new CpuMemoryDomain();
    engine.register(plugin);
    for (let i = 0; i < 30; i++) {
      const spec = engine.generate({
        domainId: "cpu-memory",
        templateId: "regression-diagnosis",
        seed: `partial-${i}`,
        difficultyBand: 3,
      });
      const first = engine.observe(spec, spec.solution.discriminatingActions[0]!, 0)!;
      const early = plugin.solve(spec, [first]);
      if (early !== null && early.hypothesisId === spec.solution.correctHypothesisId) {
        assert.fail(`seed partial-${i}: one probe gave the answer away`);
      }
    }
  });

  it("adapter metadata respects canonical practice-result constraints", () => {
    const engine = new WorldEngine();
    engine.register(new CpuMemoryDomain());
    const spec = engine.generate({
      domainId: "cpu-memory",
      templateId: "regression-diagnosis",
      seed: "adapter-7",
      difficultyBand: 2,
    });
    const meta = worldResultMetadata(spec, {
      correct: true,
      investigationsUsed: 3,
      hintsUsed: 0,
      firstPredictionCorrect: null,
    });
    for (const [k, v] of Object.entries(meta)) {
      assert.ok(k.length <= 64, `metadata key ${k} too long`);
      assert.ok(
        v === null || ["string", "number", "boolean"].includes(typeof v),
        `metadata value for ${k} must be primitive`,
      );
    }
    const params = buildWorldLaunchParameters(spec);
    assert.equal(params.domainId, "cpu-memory");
    assert.equal(params.difficultyBand, 2);
    assert.equal(WORLD_LAB_ID, "world-generator");
  });
});

(hasContract ? describe : describe.skip)("dau-practice-labs conformance", () => {
  it("round-trips a world launch through the canonical request schema", async () => {
    const contract = await import(CONTRACT.href);
    const engine = new WorldEngine();
    engine.register(new CpuMemoryDomain());
    const spec = engine.generate({
      domainId: "cpu-memory",
      templateId: "regression-diagnosis",
      seed: "contract-9",
      difficultyBand: 3,
    });
    const request = {
      schemaVersion: 1,
      sourceApp: contract.SOURCE_APP_DAU,
      labId: WORLD_LAB_ID,
      conceptId: spec.concepts[0]!.id,
      lessonId: `${spec.concepts[0]!.id}-20`,
      practiceType: "world-diagnosis",
      goal: spec.objective.slice(0, 120),
      parameters: buildWorldLaunchParameters(spec),
    };
    const encoded = contract.encodePracticeRequest(request);
    assert.ok(encoded.ok, `encode failed: ${encoded.ok ? "" : encoded.message}`);
    const decoded = contract.decodePracticeRequest(encoded.data!);
    assert.ok(decoded.ok);
    assert.deepEqual(decoded.data!.parameters, request.parameters);

    // Result envelope round-trip.
    const result = {
      schemaVersion: 1,
      labId: WORLD_LAB_ID,
      conceptId: request.conceptId,
      lessonId: request.lessonId,
      completed: true,
      attempts: 1,
      timeSpentMs: 480000,
      selfRating: 4,
      metadata: worldResultMetadata(spec, {
        correct: true,
        investigationsUsed: 3,
        hintsUsed: 0,
        firstPredictionCorrect: true,
      }),
    };
    const message = contract.createPracticeResultMessage(result);
    const incoming = contract.parseIncomingPracticeMessage(message, {
      labId: WORLD_LAB_ID,
      conceptId: request.conceptId,
      lessonId: request.lessonId,
    });
    assert.ok(incoming.ok, `result rejected: ${incoming.ok ? "" : incoming.message}`);
  });
});
