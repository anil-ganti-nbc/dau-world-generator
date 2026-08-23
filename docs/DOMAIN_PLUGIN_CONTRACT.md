# Domain Plugin Contract

*A networking world and a semiconductor world must not require the core
engine to know the physics of either. Everything domain-specific lives behind
this five-function interface (`src/core/plugin.ts`).*

## The interface

```typescript
interface DomainPlugin {
  readonly domainId: string;   // "cpu-memory"
  readonly version: string;    // semver of the domain model itself

  causes(): CauseDescriptor[];
  // The diagnosable-cause catalogue. Distractors are drawn from it, so every
  // cause must be genuinely plausible for the template's situation.

  generate(input: GenerateInput): GeneratedWorldContent;
  // input: { templateId, seed, difficultyBand: 1..5, rng (forked) }
  // Must be pure: no wall-clock, no globals. Builds hidden parameters,
  // actions, hypotheses, solution, briefing, concepts.

  observe(hidden, actionId, actionCount): Observation | null;
  // Runs a learner probe against hidden state. Pure in v1. Returns null for
  // unknown action ids. Readings are computed by simulation kernels — never
  // authored text keyed by cause.

  solve(specView, observations): { hypothesisId } | null;
  // THE INDEPENDENT SOLVER. Sees only learner-visible material. Returns the
  // hypothesis the evidence supports, or null while ambiguous ("keep
  // digging"). Validation uses it to prove solvability and distractor
  // refutability; generation never calls it.

  explain(hidden): string;
  // Canonical post-diagnosis explanation from ground truth.
}
```

## What a plugin owns vs. what the core owns

| Concern | Owner |
| --- | --- |
| Cause catalogue, plausibility rules | plugin |
| Hidden parameter construction | plugin |
| Simulation kernels / physics | plugin (`sim.ts`) |
| Observation synthesis | plugin |
| Solution path + explanation | plugin |
| Hypothesis invariant (exactly one true) | core validation |
| Solvability + distractor-refutability proof | core validation via plugin solver |
| Reproducibility (RNG discipline, fixtures) | core + tests |
| Concept provenance shape | core (ids owned by DAU curriculum) |
| Session, grading, result envelope | core/adapter |

## RNG discipline (the part that keeps worlds reproducible)

The engine hands `generate()` an Rng forked from
`hash(domainId/templateId#seed)`. Plugins must:

- use only that rng (and forks of it, e.g. `rng.fork("geometry")`);
- never draw from `Math.random`, `Date.now`, or iteration order of object
  keys with insertion-order sensitivity across versions;
- treat any added fork/draw as potentially fixture-breaking.

CI enforces this with byte-identical golden regeneration.

## Adding a second domain (checklist)

1. New package folder `src/domains/<id>/` with `sim.ts` kernels, `plugin.ts`,
   `index.ts`.
2. Declare ≥4 mutually-plausible causes for the template's situation; each
   needs a *distinct simulated signature* (see VALIDATION_MODEL.md — if two
   causes cannot produce different evidence, they are one cause).
3. Implement the solver as evidence-driven decision logic over observation
   readings only.
4. Write simulator-honesty tests (the kernel must reproduce the phenomenon).
5. Generate golden fixtures per cause; add catalog-conformance checks for the
   concept ids you reference.
6. Ship a `domain-manifest.<id>.json` describing the possibility space.

## Anti-overengineering note

Five functions is enough because v1 worlds are *diagnosis over pre-built
state*. If future modes (construction, failure-injection) need richer
surfaces — e.g. `applyAction()` returning new hidden state, or cost models
per probe — extend **this** interface with optional methods rather than
letting each domain invent its own protocol or pushing domain concepts into
the core.
