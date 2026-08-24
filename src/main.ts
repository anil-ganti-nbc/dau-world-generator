/**
 * Minimal investigation UI.
 *
 * Deliberately spartan: this exists to prove the interaction loop (generate →
 * investigate → freeze hypothesis → commit → graded verdict + explanation),
 * not to be the product surface. It also accepts Practice Labs launch
 * payloads via ?practice=<url-safe-base64-json>.
 */

import { WorldEngine } from "./core/engine.ts";
import { CpuMemoryDomain } from "./domains/cpu-memory/plugin.ts";
import type { Observation, WorldSpec } from "./core/types";
import { worldResultMetadata } from "./adapter/practice-labs.ts";

const engine = new WorldEngine();
engine.register(new CpuMemoryDomain());

interface Session {
  spec: WorldSpec;
  observations: Observation[];
  actionsRun: string[];
  frozenHypothesis: string | null;
  committed: boolean;
  startedAt: number;
}

let session: Session | null = null;

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function show(id: string, on: boolean): void {
  $(id).classList.toggle("hidden", !on);
}

// ---------------------------------------------------------------------------
// Launch payload support (?practice=...)
// ---------------------------------------------------------------------------

interface LaunchPayload {
  domainId?: string;
  templateId?: string;
  seed?: string;
  difficultyBand?: number;
}

function readLaunchPayload(): LaunchPayload | null {
  const raw = new URLSearchParams(location.search).get("practice");
  if (!raw) return null;
  if (raw === "demo") {
    return { domainId: "cpu-memory", templateId: "regression-diagnosis", seed: "first-world", difficultyBand: 3 };
  }
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
    const parsed = JSON.parse(json) as { parameters?: LaunchPayload } & LaunchPayload;
    // Accept both a bare parameters object and the canonical request envelope.
    return parsed.parameters ?? parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
}

function renderWorld(): void {
  if (!session) return;
  const { spec } = session;
  $("world-title").textContent = spec.title;
  $("world-objective").textContent = spec.objective;

  const briefing = $("briefing");
  briefing.replaceChildren(
    ...spec.briefing.split("\n\n").map((p) => el("p", {}, p)),
  );

  renderActions();
  renderHypotheses();
  renderLog();
  updateCommit();
  show("setup", false);
  show("world", true);
  show("result", false);
}

function renderActions(): void {
  if (!session) return;
  const box = $("actions");
  box.replaceChildren();

  // Probe budget (band ≥3 worlds brief that reruns are budgeted): each
  // probe costs its action cost from a fixed allowance. cache-params is
  // free. The budget is advisory pressure, not a hard wall — the commit
  // button stays available; the UI shows remaining budget so random
  // clicking is visibly wasteful.
  const band = session.spec.difficulty.band;
  const budget = band >= 3 ? 5 : Infinity;
  const spent = session.actionsRun
    .map((id) => ACTION_COST[id] ?? 1)
    .reduce((a, b) => a + b, 0);
  if (band >= 3) {
    const left = budget - spent;
    box.appendChild(
      el(
        "p",
        { class: "hint" },
        `Probe budget: ${spent}/${budget} rerun-units used${left > 0 ? ` · ${left} left` : " · budget exhausted — commit when ready"}.`,
      ),
    );
  }

  for (const action of session.spec.actions) {
    const used = session.observations.some((o) => o.actionId === action.id);
    const btn = el("button", { class: "action-btn" }, action.label);
    btn.appendChild(
      el("small", {}, `${ACTION_COST[action.id] !== undefined && ACTION_COST[action.id]! > 0 ? `[cost ${ACTION_COST[action.id]}] ` : ""}${used ? "already probed (free to re-read)" : action.description}`),
    );
    btn.addEventListener("click", () => runAction(action.id));
    box.appendChild(btn);
  }
}

const ACTION_COST: Record<string, number> = {
  "perf-counters": 1,
  "cache-params": 0,
  "miss-timeline": 1,
  "set-distribution": 1,
  "coherence-probe": 1,
  "prefetch-audit": 1,
  "prefetch-off-run": 2,
};

function runAction(actionId: string): void {
  if (!session || session.committed) return;
  const obs = engine.observe(session.spec, actionId, session.observations.length);
  if (!obs) return;
  // Replace any earlier observation of the same action (re-reading is free).
  session.observations = session.observations.filter((o) => o.actionId !== actionId);
  session.observations.push(obs);
  if (!session.actionsRun.includes(actionId)) session.actionsRun.push(actionId);
  renderActions();
  renderLog();
  updateCommit();
}

function renderLog(): void {
  if (!session) return;
  const log = $("log");
  if (session.observations.length === 0) {
    log.replaceChildren(el("p", { class: "hint empty" }, "No probes yet."));
    return;
  }
  log.replaceChildren(
    ...session.observations.map((obs) => {
      const wrap = el("div", { class: "obs" });
      wrap.appendChild(el("p", { class: "summary" }, obs.summary));
      const table = el("table");
      for (const r of obs.readings) {
        const tr = el("tr");
        tr.appendChild(el("td", {}, r.name));
        tr.appendChild(el("td", {}, r.value));
        table.appendChild(tr);
      }
      wrap.appendChild(table);
      return wrap;
    }),
  );
}

function renderHypotheses(): void {
  if (!session) return;
  const box = $("hypotheses");
  box.replaceChildren();
  for (const h of session.spec.hypotheses) {
    const card = el("div", {
      class: `hypothesis${session.frozenHypothesis === h.id ? " frozen" : ""}`,
    });
    card.appendChild(el("strong", {}, h.label));
    card.appendChild(el("small", { style: "display:block" }, h.detail));
    if (session.frozenHypothesis === h.id) {
      card.appendChild(el("small", { class: "frozen-tag" }, "· frozen prediction"));
    }
    card.addEventListener("click", () => {
      if (!session || session.committed) return;
      session.frozenHypothesis = session.frozenHypothesis === h.id ? null : h.id;
      renderHypotheses();
      updateCommit();
    });
    box.appendChild(card);
  }
}

function updateCommit(): void {
  const btn = $("commit") as HTMLButtonElement;
  const ready = Boolean(session && session.frozenHypothesis && !session.committed);
  btn.disabled = !ready;
  btn.textContent = session?.committed
    ? "Diagnosis committed"
    : session?.frozenHypothesis
      ? "Commit diagnosis"
      : "Freeze a hypothesis to commit";
}

function commit(): void {
  if (!session || !session.frozenHypothesis || session.committed) return;
  session.committed = true;
  const { spec, frozenHypothesis } = session;
  const correct = engine.isCorrect(spec, frozenHypothesis);
  const explanation = engine.explain(spec);

  const body = $("result-body");
  body.replaceChildren();

  body.appendChild(
    el(
      "p",
      { class: correct ? "verdict-good" : "verdict-bad" },
      correct ? "✔ Correct diagnosis." : "✘ Not the root cause.",
    ),
  );
  const chosen = spec.hypotheses.find((h) => h.id === frozenHypothesis);
  body.appendChild(el("p", {}, `You committed to: ${chosen?.label ?? frozenHypothesis}`));

  body.appendChild(el("h3", {}, "What actually happened"));
  body.appendChild(el("div", { class: "explanation" }, explanation));

  // Result payload exactly as it would go back to DAU.
  const result = {
    schemaVersion: 1,
    labId: "world-generator",
    conceptId: spec.concepts[0]?.id ?? "cpu-cache-miss",
    lessonId: `${spec.concepts[0]?.id ?? "cpu-cache-miss"}-20`,
    completed: correct,
    attempts: Math.max(1, session.observations.filter((_, i) => i > 0).length),
    timeSpentMs: Date.now() - session.startedAt,
    selfRating: 3,
    metadata: worldResultMetadata(spec, {
      correct,
      investigationsUsed: session.observations.length,
      hintsUsed: 0,
      firstPredictionCorrect:
        session.frozenHypothesis !== null &&
        session.observations.length <= spec.difficulty.minInvestigations
          ? correct
          : null,
    }),
  };
  body.appendChild(el("h3", {}, "Practice evidence returned to DAU"));
  body.appendChild(el("pre", { class: "result-json" }, JSON.stringify(result, null, 2)));

  show("world", false);
  show("result", true);
}

// ---------------------------------------------------------------------------
// Wire-up
// ---------------------------------------------------------------------------

$("generate").addEventListener("click", () => {
  const spec = engine.generate({
    domainId: ($("domain") as HTMLSelectElement).value,
    templateId: ($("template") as HTMLSelectElement).value,
    seed: ($("seed") as HTMLInputElement).value.trim() || "default",
    difficultyBand: parseInt(($("band") as HTMLSelectElement).value, 10),
  });
  session = { spec, observations: [], actionsRun: [], frozenHypothesis: null, committed: false, startedAt: Date.now() };
  renderWorld();
});

$("commit").addEventListener("click", commit);

$("again").addEventListener("click", () => {
  show("result", false);
  show("setup", true);
});

// Honour practice payloads on load.
const launch = readLaunchPayload();
if (launch?.seed) {
  if (launch.domainId && launch.templateId && launch.difficultyBand) {
    try {
      const spec = engine.generate({
        domainId: launch.domainId,
        templateId: launch.templateId,
        seed: launch.seed,
        difficultyBand: launch.difficultyBand,
      });
      session = { spec, observations: [], actionsRun: [], frozenHypothesis: null, committed: false, startedAt: Date.now() };
      renderWorld();
    } catch (err) {
      console.error("launch payload rejected by validation:", err);
    }
  } else {
    ($("seed") as HTMLInputElement).value = launch.seed;
  }
}
