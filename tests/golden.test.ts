/**
 * Golden fixture tests.
 *
 * The pinned worlds under fixtures/worlds/ must remain byte-identical when
 * regenerated. Any engine or domain change that alters a fixture is a
 * breaking change to reproducibility and must be made consciously (update
 * fixtures in the same commit, note it in the changelog).
 *
 * Also verifies every fixture still validates: solvable, one true hypothesis,
 * declared evidence path actually solves, hidden cause consistent with
 * solution model.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { WorldEngine } from "../src/core/engine.ts";
import { CpuMemoryDomain } from "../src/domains/cpu-memory/plugin.ts";
import { validateWorldStructure } from "../src/core/validate.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "fixtures", "worlds");

function loadFixtures(): Array<{ name: string; json: string }> {
  try {
    return readdirSync(fixtureDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ name: f, json: readFileSync(join(fixtureDir, f), "utf-8") }));
  } catch {
    return [];
  }
}

describe("golden worlds", () => {
  const fixtures = loadFixtures();

  it("fixtures exist", () => {
    assert.ok(fixtures.length >= 4, `expected >=4 golden worlds, found ${fixtures.length}`);
  });

  for (const fx of fixtures) {
    it(`${fx.name} matches regeneration from its seed`, () => {
      const spec = JSON.parse(fx.json);
      const engine = new WorldEngine();
      engine.register(new CpuMemoryDomain());
      const [domainId, templateId] = spec.templateId.split("/");
      const regenerated = engine.generate({
        domainId,
        templateId,
        seed: spec.seed,
        difficultyBand: spec.difficulty.band,
      });
      assert.deepEqual(JSON.parse(JSON.stringify(regenerated)), spec);
    });

    it(`${fx.name} still validates and solves`, () => {
      const spec = JSON.parse(fx.json);
      const issues = validateWorldStructure(spec);
      assert.equal(issues.filter((i) => i.severity === "error").length, 0);
      const plugin = new CpuMemoryDomain();
      const observations = spec.solution.discriminatingActions.map((id: string, n: number) =>
        plugin.observe(spec.hidden, id, n),
      );
      const verdict = plugin.solve(spec, observations);
      assert.equal(verdict?.hypothesisId, spec.solution.correctHypothesisId);
    });
  }
});
