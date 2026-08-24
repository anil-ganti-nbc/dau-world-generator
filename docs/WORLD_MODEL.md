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
(that is what forces investigation). v0.2 adds an optional `unrefutable`
flag: when a distractor shares the truth's evidence signature and no probe
in the world can exclude it, the world declares that honestly instead of
pretending refutation.

**SolutionModel is an evidence contract, not just an answer.**
`solution.discriminatingActions` names actions whose combined evidence
identifies the cause. Validation runs the independent solver along this path,
refuses worlds where it fails — or where a strict prefix already gives the
answer away — and additionally enumerates alternative solving subsets so the
number of valid investigation strategies is a measured property.

**Hidden state is sealed by convention + schema position, not encryption.**
The UI layer receives the whole spec. The rule is enforced by review and by
the UI's structure: no render path touches `spec.hidden`. Server-side hosting
could seal it later without schema change.

**DifficultyProfile replaces Easy/Medium/Hard.**

```text
band                  1–5 overall band (drives generation choices)
relevantVariables     state variables that actually matter
distractorHypotheses  plausible wrong explanations kept alive
causalDepth           causal steps from root cause to headline symptom
observability         fraction of truth-relevant variables directly observable
minInvestigations     probes a competent solver needs (lower bound on cost)
```

Generation maps band → structural choices; validation checks claims against
the built spec rather than trusting the generator's self-report.

## Concept references

```typescript
interface ConceptRef { id: string; tier: number }  // e.g. cpu-cache-miss, tier 2
```

Concept ids are **owned by canonical DAU**. The generator copies id+tier at
generation time into the world (so a world is self-describing) and validates
ids against catalog snapshots in CI-style tests. The generator never invents
concept ids; a new concept requires a curriculum PR first.

## Example (abridged golden fixture)

See `fixtures/worlds/*.json` — one per solver-supported family at bands 2
and 4, pinned byte-for-byte to their seeds. Abridged shape:

```jsonc
{
  "schemaVersion": 1,
  "templateId": "cpu-memory/regression-diagnosis",
  "title": "Same Code, Different Machine",
  "domainId": "cpu-memory",
  "seed": "golden-false-sharing-2-5",
  "concepts": [
    { "id": "cpu-coherency", "tier": 2 },
    { "id": "cpu-mesi", "tier": 3 }
  ],
  "difficulty": {
    "band": 2, "relevantVariables": 4, "distractorHypotheses": 2,
    "causalDepth": 1, "observability": 0.69, "minInvestigations": 2
  },
  "briefing": "A routine profiling pass shows the hot loop … regressed …",
  "hidden": { "causeId": "false-sharing", "parameters": { "…": "geometry + workload phases" } },
  "actions": [ { "id": "perf-counters", "kind": "measure" }, "…" ],
  "hypotheses": [ { "id": "capacity-miss", "isTrue": false }, { "id": "false-sharing", "isTrue": true }, "…" ],
  "solution": {
    "correctHypothesisId": "false-sharing",
    "discriminatingActions": ["perf-counters", "coherence-probe"],
    "explanation": "Two cores write different variables that share one cache line…"
  }
}
```

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
