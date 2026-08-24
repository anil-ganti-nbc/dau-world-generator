// Full seed-fuzz sweep: thousands of seeds, machine-readable statistics.
// Run: node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/seedfuzz.ts [count]
import { WorldEngine } from "../src/core/engine.ts";
import { CpuMemoryDomain } from "../src/domains/cpu-memory/plugin.ts";
import { solveCheck, validateWorldStructure } from "../src/core/validate.ts";
import { SOLVER_SUPPORTED } from "../src/domains/cpu-memory/families.ts";
import { writeFileSync, mkdirSync } from "node:fs";

const engine = new WorldEngine();
engine.register(new CpuMemoryDomain());
const plugin = new CpuMemoryDomain();

const PER_BAND = Number(process.argv[2] ?? 400);
const BANDS = [1, 2, 3, 4, 5];

interface BandStats {
  band: number;
  seeds: number;
  generated: number;
  generationFailures: number;
  validationFailures: number;
  solvable: number;
  unsolvable: number;
  earlySolves: number;
  nonDiagnostic: number;
  causesSeen: Record<string, number>;
  uniqueFingerprints: number;
  avgAlternativePaths: number;
  maxAlternativePaths: number;
  avgDistinctAlternativePaths: number;
  maxDistinctAlternativePaths: number;
}

const results: BandStats[] = [];
const t0 = Date.now();

for (const band of BANDS) {
  const s: BandStats = {
    band,
    seeds: PER_BAND,
    generated: 0,
    generationFailures: 0,
    validationFailures: 0,
    solvable: 0,
    unsolvable: 0,
    earlySolves: 0,
    nonDiagnostic: 0,
    causesSeen: {},
    uniqueFingerprints: 0,
    avgAlternativePaths: 0,
    maxAlternativePaths: 0,
    avgDistinctAlternativePaths: 0,
    maxDistinctAlternativePaths: 0,
  };
  const prints = new Set<string>();
  let altSum = 0;
  let distinctAltSum = 0;
  for (let i = 0; i < PER_BAND; i++) {
    const seed = `fuzz-${band}-${i}`;
    let spec;
    try {
      spec = engine.generate({
        domainId: "cpu-memory",
        templateId: "regression-diagnosis",
        seed,
        difficultyBand: band as 1 | 2 | 3 | 4 | 5,
      });
      s.generated++;
      s.causesSeen[spec.hidden.causeId] = (s.causesSeen[spec.hidden.causeId] ?? 0) + 1;
    } catch {
      s.generationFailures++;
      continue;
    }
    const h = spec.hidden.parameters as { variantLabel?: string; geometry?: unknown };
    prints.add(`${spec.hidden.causeId}|${h.variantLabel}|${JSON.stringify(h.geometry)}`);
    const structural = validateWorldStructure(spec);
    if (structural.some((x) => x.severity === "error")) s.validationFailures++;
    const report = solveCheck(spec, plugin);
    if (report.solvable) s.solvable++;
    else s.unsolvable++;
    if (report.earlySolveAt !== null && report.earlySolveAt < spec.solution.discriminatingActions.length - 0) {
      // only count early solves that reveal before the final probe
    }
    if (report.survivingDistractors.length > 0 && !report.distractorsRefutable) s.nonDiagnostic++;
    altSum += report.solvingSubsetsTotal;
    distinctAltSum += report.alternativePaths;
    s.maxAlternativePaths = Math.max(s.maxAlternativePaths, report.solvingSubsetsTotal);
    s.maxDistinctAlternativePaths = Math.max(s.maxDistinctAlternativePaths, report.alternativePaths);
  }
  s.uniqueFingerprints = prints.size;
  s.avgAlternativePaths = s.generated > 0 ? Math.round((altSum / s.generated) * 10) / 10 : 0;
  // Distinctness-weighted: subsets containing the declared path are padding.
  s.avgDistinctAlternativePaths = s.generated > 0 ? Math.round((distinctAltSum / s.generated) * 10) / 10 : 0;
  results.push(s);
}

const summary = {
  tool: "dau-world-generator seedfuzz",
  domain: "cpu-memory/regression-diagnosis",
  domainVersion: "2.0.0",
  ranAt: new Date().toISOString(),
  perBandMs: Math.round((Date.now() - t0) / BANDS.length),
  totalSeeds: results.reduce((n, r) => n + r.seeds, 0),
  bands: results,
};

mkdirSync("fixtures", { recursive: true });
writeFileSync("fixtures/seedfuzz-results.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
