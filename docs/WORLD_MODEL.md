# World Model

*The canonical data model for a DAU World. Versioned schemas live in
`schemas/`; the TypeScript source of truth is `src/core/types.ts`.*

## Design stance

The brief's proposed structure (World Definition → Domain Model → … →
Evaluation) is a **generation pipeline**, not a data model. The data model
below is what that pipeline produces and what the runtime consumes. It is
deliberately small: everything domain-specific hides behind two opaque
objects (`hidden.parameters`) so the core never grows physics.

## WorldSpec v1

```text
WorldSpec
├─ schemaVersion: 1
├─ templateId: "cpu-memory/regression-diagnosis"   (domainId/templateId)
├─ title, briefing, objective                      (learner-facing prose)
├─ domainId, seed                                  (reproduction coordinates)
├─ concepts: ConceptRef[]                          (DAU provenance)
├─ prerequisiteConceptIds: string[]
├─ difficulty: DifficultyProfile                   (structured, not labels)
├─ hidden: { causeId, parameters }                 (NEVER rendered to learner)
│    └─ parameters: opaque record owned by the domain plugin
├─ actions: WorldAction[]                          (inspect|measure|run|configure)
├─ hypotheses: Hypothesis[]                        (exactly one isTrue)
├─ solution: SolutionModel                         (machine-checkable contract)
└─ meta: { generatedAt, domainVersion, engineVersion }
```

### Key decisions

**Hypotheses are first-class.** Each carries `label`, `detail` (mechanism),
and `isTrue`. Exactly one true hypothesis is a structural invariant; ≥2
distractors above band 1. Distractors must be *defensible from the briefing*
(that is what forces investigation) and *refutable from evidence* (that is
what makes the world solvable).

**SolutionModel is an evidence contract, not just an answer.**
`solution.discriminatingActions` names the actions whose combined evidence
identifies the cause. Validation runs the independent solver along exactly
this path and refuses worlds where it fails — or where a strict prefix of the
path already gives the answer away.

**Hidden state is sealed by convention + schema position, not encryption.**
The UI layer receives the whole spec (it needs `hidden.causeId`-adjacent data
through the plugin's observe/explain calls anyway). The rule is enforced by
review and by the UI's structure: no render path touches `spec.hidden`.
Server-side hosting could seal it later without schema change.

**DifficultyProfile replaces Easy/Medium/Hard.**

```text
band                  1–5 overall band (drives generation choices)
relevantVariables     state variables that actually matter
distractorHypotheses  plausible wrong explanations kept alive
causalDepth           causal steps from root cause to headline symptom
observability         fraction of truth-relevant variables directly observable
minInvestigations     probes a competent solver needs (lower bound on cost)
```

Generation maps band → structural choices (see DIFFICULTY_MODEL.md); the
profile records what was actually built, so validation can check claims
against reality rather than trusting the generator's self-report.

## Concept references

```typescript
interface ConceptRef { id: string; tier: number }  // e.g. cpu-cache-miss, tier 2
```

Concept ids are **owned by canonical DAU**. The generator copies id+tier at
generation time into the world (so a world is self-describing) and validates
ids against catalog snapshots in CI-style tests. The generator never invents
concept ids; a new concept requires a curriculum PR first.

## Example (abridged golden fixture)

```jsonc
{
  "schemaVersion": 1,
  "templateId": "cpu-memory/regression-diagnosis",
  "title": "Same Code, Different Machine",
  "domainId": "cpu-memory",
  "seed": "golden-conflict-01",
  "concepts": [
    { "id": "cpu-cache-levels", "tier": 2 },
    { "id": "cpu-cache-miss", "tier": 2 }
  ],
  "prerequisiteConceptIds": ["cpu-cache-levels"],
  "objective": "Diagnose why the hot loop regressed …",
  "difficulty": {
    "band": 3, "relevantVariables": 7, "distractorHypotheses": 3,
    "causalDepth": 2, "observability": 0.75, "minInvestigations": 2
  },
  "briefing": "A routine profiling pass shows the hot loop of your
    index-compactor service has regressed measurably since yesterday…",
  "hidden": { "causeId": "conflict-miss", "parameters": { "…": "geometry, address streams" } },
  "actions": [ { "id": "perf-counters", "kind": "measure", "…": "…" }, "…" ],
  "hypotheses": [
    { "id": "capacity-miss",   "label": "Working set exceeds cache", "isTrue": false, "…": "…" },
    { "id": "conflict-miss",   "label": "Cache set conflicts",       "isTrue": true,  "…": "…" },
    { "id": "false-sharing",   "label": "False sharing",             "isTrue": false, "…": "…" }
  ],
  "solution": {
    "correctHypothesisId": "conflict-miss",
    "discriminatingActions": ["perf-counters", "set-distribution"],
    "explanation": "The new layout maps the hottest lines onto one cache set…"
  }
}
```

Full pinned examples: `fixtures/worlds/*.json`.

## What deliberately did NOT make v1

- **Timeline/event log inside the spec.** v1 worlds are stateless diagnosis;
  observations are pure functions of hidden state. When state-changing actions
  arrive (configure/run), a session journal moves into the *session* object,
  not the spec.
- **Learner identity / scoring fields.** Belong to DAU.
- **Hints.** Hint ladders will attach to templates as separate versioned
  content once misconception targeting lands; not part of the world itself.
- **Narrative variants.** One briefing per world today; variant wording is a
  later, optional LLM-assisted pass over an unchanged `hidden`.

Any addition goes through a `schemaVersion` bump with a migration note here.
