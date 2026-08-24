// Generative-breadth audit for the v0.2 domain.
// Sweeps seeds and reports structural diversity + failure rates.
import { WorldEngine } from "../src/core/engine.ts";
import { CpuMemoryDomain } from "../src/domains/cpu-memory/plugin.ts";
import { writeFileSync } from "node:fs";

const engine = new WorldEngine();
engine.register(new CpuMemoryDomain());

const N = Number(process.argv[2] ?? 400);
const worlds: Array<Record<string, unknown>> = [];
let failures = 0;
let validationFails = 0;

for (let i = 0; i < N; i++) {
  const seed = `audit-${i}`;
  try {
    const spec = engine.generate({
      domainId: "cpu-memory",
      templateId: "regression-diagnosis",
      seed,
      difficultyBand: 3,
    });
    const h = spec.hidden.parameters as {
      geometry: { sizeBytes: number; associativity: number };
      variantLabel: string;
      workload: { phases: Array<{ addrs: number[]; reps: number; label: string }> };
      baseline: { phases: Array<{ addrs: number[] }> };
    };
    const distinctLines = new Set(
      h.workload.phases.flatMap((p) => p.addrs).map((a) => Math.floor(a / 64)),
    ).size;
    worlds.push({
      seed,
      cause: spec.hidden.causeId,
      variant: h.variantLabel,
      geometry: `${h.geometry.sizeBytes / 1024}K/${h.geometry.associativity}`,
      streamLen: h.workload.phases.reduce((n, p) => n + p.addrs.length * p.reps, 0),
      phaseCount: h.workload.phases.length,
      distinctLines,
      path: spec.solution.discriminatingActions.join(">"),
      hypotheses: spec.hypotheses.length,
      band: spec.difficulty.band,
    });
  } catch (e) {
    failures++;
    if (String(e).includes("failed validation")) validationFails++;
  }
}

const by = new Map<string, any[]>();
for (const w of worlds) {
  if (!by.has(w.cause as string)) by.set(w.cause as string, []);
  (by.get(w.cause) as any[]).push(w);
}
console.log(`generated ${worlds.length}/${N} seeds, failures=${failures} (validation-rejected: ${validationFails})\n`);

for (const [cause, ws] of by) {
  const variants = new Set(ws.map((w) => w.variant));
  const geoms = new Set(ws.map((w) => w.geometry));
  const lens = [...new Set(ws.map((w) => w.streamLen))].sort((a, b) => a - b);
  const paths = new Set(ws.map((w) => w.path));
  const fingerprints = new Set(ws.map((w) => `${w.variant}|${w.geometry}|${w.streamLen}`));
  console.log(`${cause}: n=${ws.length}`);
  console.log(`  variants:          ${variants.size} -> ${[...variants].join(", ")}`);
  console.log(`  geometries:        ${geoms.size}`);
  console.log(`  stream lengths:    ${lens.length} (${lens.slice(0, 6).join(",")}${lens.length > 6 ? "..." : ""})`);
  console.log(`  solution paths:    ${paths.size} -> ${[...paths][0]}`);
  console.log(`  fingerprints:      ${fingerprints.size} over ${ws.length} seeds`);
}

const allPrints = new Set(worlds.map((w) => `${w.cause}|${w.variant}|${w.geometry}|${w.streamLen}|${w.phaseCount}`));
console.log(`\nGLOBAL structural fingerprints: ${allPrints.size} over ${worlds.length} worlds (${(100 * allPrints.size / worlds.length).toFixed(0)}% unique)`);

writeFileSync("audit-v02.json", JSON.stringify({ generated: worlds.length, failures, worlds }, null, 2));
console.log("\nwrote audit-v02.json");
