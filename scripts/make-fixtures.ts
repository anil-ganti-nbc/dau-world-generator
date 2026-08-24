// Regenerate golden fixture worlds under fixtures/worlds/.
// Run: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/make-fixtures.ts
//
// v0.2: one fixture per SOLVER-SUPPORTED cause (the gradable truths), plus
// one per band for the flagship family. Fixtures pin reproducibility; the
// broader property tests live in tests/seedfuzz.test.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { WorldEngine, WorldGenerationError } from "../src/core/engine.ts";
import { CpuMemoryDomain, DOMAIN_VERSION } from "../src/domains/cpu-memory/plugin.ts";
import { FAMILIES, SOLVER_SUPPORTED, type FamilyId } from "../src/domains/cpu-memory/families.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "fixtures", "worlds");
mkdirSync(outDir, { recursive: true });

const engine = new WorldEngine();
engine.register(new CpuMemoryDomain());

function findWorld(cause: FamilyId, band: number): { seed: string; spec: ReturnType<WorldEngine["generate"]> } {
  const prefix = `golden-${cause}-${band}`;
  for (let attempt = 0; attempt < 400; attempt++) {
    const seed = `${prefix}-${attempt}`;
    try {
      const spec = engine.generate({
        domainId: "cpu-memory",
        templateId: "regression-diagnosis",
        seed,
        difficultyBand: band,
      });
      if (spec.hidden.causeId === cause) return { seed, spec };
    } catch (e) {
      if (!(e instanceof WorldGenerationError)) throw e;
      // validation-rejected seed: keep scanning
    }
  }
  throw new Error(`no seed produced solvable ${cause} at band ${band}`);
}

const causes = FAMILIES.map((f) => f.id).filter((id) => SOLVER_SUPPORTED.has(id));
for (const cause of causes) {
  for (const band of [2, 4]) {
    const { seed, spec } = findWorld(cause as FamilyId, band as 1 | 2 | 3 | 4 | 5);
    // keep the actual seed in the spec for regeneration
    const file = join(outDir, `${cause}-band${band}.json`);
    writeFileSync(file, JSON.stringify(spec, null, 2) + "\n");
    console.log("wrote", file, `(seed ${seed})`);
  }
}

// Domain manifest (mirrors the plugin's declared surface).
const manifest = {
  domainId: "cpu-memory",
  version: DOMAIN_VERSION,
  name: "CPU memory hierarchy",
  description:
    "Diagnostic worlds over cache behaviour. All evidence is produced by real set-associative cache / coherence / prefetch simulations across a 12-family causal catalogue.",
  causes: FAMILIES.map((f) => ({ id: f.id, label: f.label })),
  templates: [
    {
      templateId: "regression-diagnosis",
      modes: ["diagnostic"],
      difficultyBands: [1, 2, 3, 4, 5],
      conceptIds: [
        "cpu-cache-levels",
        "cpu-cache-miss",
        "cpu-write-policy",
        "cpu-coherency",
        "cpu-mesi",
        "cpu-prefetch",
        "cpu-memory-wall",
      ],
    },
  ],
};
writeFileSync(join(outDir, "..", "domain-manifest.cpu-memory.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("wrote domain manifest");
