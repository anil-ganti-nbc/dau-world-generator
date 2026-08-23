// Smoke: generate one cpu-memory world and print learner-visible + hidden views.
import { WorldEngine } from "../src/core/engine.ts";
import { CpuMemoryDomain } from "../src/domains/cpu-memory/plugin.ts";

const engine = new WorldEngine();
engine.register(new CpuMemoryDomain());

const spec = engine.generate({
  domainId: "cpu-memory",
  templateId: "regression-diagnosis",
  seed: "smoke-001",
  difficultyBand: 3,
});

console.log("title:", spec.title);
console.log("template:", spec.templateId, "| seed:", spec.seed);
console.log("concepts:", spec.concepts.map((c) => c.id).join(", "));
console.log("difficulty:", JSON.stringify(spec.difficulty));
console.log("\nbriefing:\n" + spec.briefing);
console.log("\nactions:", spec.actions.map((a) => a.id).join(", "));
console.log("hypotheses:");
for (const h of spec.hypotheses) console.log(`  - ${h.id}${h.isTrue ? "  [TRUE]" : ""}`);
console.log("discriminating path:", spec.solution.discriminatingActions.join(" -> "));

console.log("\n--- evidence along the declared path ---");
let n = 0;
for (const actionId of spec.solution.discriminatingActions) {
  const obs = engine.observe(spec, actionId, n++);
  if (!obs) continue;
  console.log(`\n[${obs.actionId}] ${obs.summary}`);
  for (const r of obs.readings) console.log(`   ${r.name}: ${r.value}`);
}

console.log("\n--- solver verdict from those observations ---");
const obs = spec.solution.discriminatingActions.map((id, i) => engine.observe(spec, id, i)!);
const verdict = new CpuMemoryDomain().solve(spec, obs);
console.log(verdict);

console.log("\n--- canonical explanation ---");
console.log(engine.explain(spec));

console.log("\n--- hidden cause (never shown to learners):", spec.hidden.causeId);
