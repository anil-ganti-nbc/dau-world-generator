# Generation Pipeline

*Generation as a constrained process inside a defined possibility space —
never free-form invention.*

## The pipeline

```
learning objective (DAU concepts + tier band)
  → template selection            (deterministic; caller-chosen in v1)
  → cause selection               (stochastic, from plugin catalogue)
  → distractor set                (stochastic, remaining plausible causes)
  → hidden parameter construction (rule-based: streams/geometry per cause)
  → baseline construction         (rule-based: benign twin of same workload)
  → action + hypothesis assembly  (rule-based + stochastic ordering)
  → difficulty realisation        (band → structural choices)
  → briefing assembly             (templated prose; never names the cause)
  → structural validation         (invariants)
  → solver validation             (solvability, no-early-solve, refutability)
  → WorldSpec (sealed)            (+ golden fixture if new coverage)
```

## Which stages are what

| Stage | Nature | Notes |
| --- | --- | --- |
| Template selection | deterministic | `(domainId, templateId)` given by caller |
| Cause selection | stochastic (seeded) | uniform over catalogue in v1; later weighted by learner model |
| Distractor selection | stochastic (seeded) | all remaining causes above band 1 |
| Hidden parameters | **pure rule-based** | the heart: e.g. conflict worlds build N>associativity distinct lines mapping to one set |
| Baseline twin | pure rule-based | known-good variant of the same workload for honest before/after evidence |
| Observations at runtime | pure rule-based | simulation kernels re-run on demand |
| Briefing prose | templated | slot-filled from geometry/workload facts; cause-neutral by construction and tested |
| Narrative polish / hint text | optional LLM, later | may rephrase; must not touch hidden, actions, hypotheses, solution |

## Possibility space discipline

The generator cannot produce arbitrary combinations because:

1. **Causes come from a fixed catalogue** with declared mechanism summaries.
2. **Each cause has exactly one hidden-state recipe per template**, written so
   that real simulation yields its signature symptom class (verified by
   simulator-honesty tests).
3. **Distractors are other catalogue entries**, so every wrong hypothesis is
   one the domain expert endorsed as plausible.
4. **Difficulty changes structure** (see DIFFICULTY_MODEL.md), not prose.

Adding a possibility = adding a catalogue entry + a recipe + honesty tests +
fixtures. Nothing else in the pipeline changes.

## Worked example (`cpu-memory/regression-diagnosis`, cause = conflict-miss)

1. rng picks `conflict-miss` from four causes; three become distractors.
2. Geometry drawn: 16 KiB, 64 B lines, 4-way → 64 sets.
3. Recipe: pick set index s; take associativity+1..+2 distinct addresses
   congruent to set s; interleave with a 16-line resident region; repeat 96
   passes → hot lines genuinely thrash set s while everything else hits.
4. Baseline twin: same access count over a small resident window.
5. Actions/hypotheses assembled; hypotheses shuffled; solution path declared
   (`perf-counters → set-distribution`).
6. Validation runs the solver along the path (must conclude `conflict-miss`),
   checks prefixes don't solve early, checks each distractor is refuted or
   implicitly eliminated.
7. Spec sealed. If seed is a golden seed, CI pins it byte-for-byte.

## Failure handling

Any validation error throws `WorldGenerationError` — the engine returns *no
world* rather than a repaired-looking one. There is deliberately no
auto-repair loop in v1: a generation recipe that fails validation is a bug in
the recipe (fix the recipe), not noise to paper over. A bounded
regenerate-with-new-seed retry may be added later for genuinely stochastic
edge cases, but only alongside a metric tracking how often recipes fail.
