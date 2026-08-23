// Regenerate golden fixture worlds under fixtures/worlds/.
// Run: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/make-fixtures.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { WorldEngine } from "../src/core/engine.ts";
import { CpuMemoryDomain, DOMAIN_VERSION } from "../src/domains/cpu-memory/plugin.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "fixtures", "worlds");
mkdirSync(outDir, { recursive: true });

const engine = new WorldEngine();
engine.register(new CpuMemoryDomain());

// One fixture per cause so every branch of the possibility space has a
// pinned example. Seeds are stable: changing any generation code that alters
// these outputs is a breaking change and must update fixtures deliberately.
const FIXTURES: Array<{ seed: string; band: number; cause: string }> = [
  { seed: "golden-conflict-01", band: 3, cause: "conflict-miss" },
  { seed: "golden-capacity-01", band: 3, cause: "capacity-miss" },
  { seed: "golden-fs-01", band: 3, cause: "false-sharing" },
  { seed: "golden-storm-01", band: 3, cause: "prefetch-storm" },
];

for (const f of FIXTURES) {
  let spec;
  for (let attempt = 0; attempt < 200; attempt++) {
    const seed = attempt === 0 ? f.seed : `${f.seed}-${attempt}`;
    const candidate = engine.generate({
      domainId: "cpu-memory",
      templateId: "regression-diagnosis",
      seed,
      difficultyBand: f.band,
    });
    if (candidate.hidden.causeId === f.cause) {
      spec = candidate;
      // keep the original seed name in the spec for readability
      spec.seed = seed;
      break;
    }
  }
  if (!spec) throw new Error(`no seed produced cause ${f.cause}`);
  const file = join(outDir, `cpu-memory-${f.cause}.json`);
  writeFileSync(file, JSON.stringify(spec, null, 2) + "\n");
  console.log("wrote", file);
}

// Domain manifest (mirrors the plugin's declared surface).
const manifest = {
  domainId: "cpu-memory",
  version: DOMAIN_VERSION,
  name: "CPU memory hierarchy",
  description:
    "Diagnostic worlds over cache behaviour: conflicts, capacity, coherence, and prefetch interaction. All evidence is produced by real set-associative cache / coherence / prefetch simulations.",
  causes: [
    { id: "conflict-miss", label: "Cache set conflicts" },
    { id: "capacity-miss", label: "Working set exceeds cache" },
    { id: "false-sharing", label: "False sharing between cores" },
    { id: "prefetch-storm", label: "Useless prefetch traffic" },
  ],
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
      ],
    },
  ],
};
writeFileSync(join(outDir, "..", "domain-manifest.cpu-memory.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("wrote domain manifest");
