# Generation Pipeline

*Generation as a constrained process inside a defined possibility space —
never free-form invention.*

## The pipeline (v0.2, cpu-memory)

```
learning objective (DAU concepts + tier band)
  → template selection            (deterministic; caller-chosen in v1)
  → truth-family selection        (stochastic, from SOLVER_SUPPORTED subset)
  → variant selection             (stochastic; structural sub-recipes)
  → geometry draw                 (size × associativity; optional L2)
  → hidden parameter construction (rule-based: streams/geometry per variant)
  → HONEST-TRUTH GUARD            (re-draw if variant ≈ sibling under probes)
  → distractor set                (stochastic, evidence-separable families)
  → action + hypothesis assembly  (rule-based + stochastic ordering)
  → difficulty realisation        (band → structural choices)
  → briefing assembly             (templated prose; never names the cause)
  → structural validation         (invariants)
  → solver validation             (solvability, no-early-solve,
                                   refutation, multi-path discovery)
  → WorldSpec (sealed)            (+ golden fixture if new coverage)
```

## Which stages are what

| Stage | Nature | Notes |
| --- | --- | --- |
| Template selection | deterministic | `(domainId, templateId)` given by caller |
| Truth-family selection | stochastic (seeded) | uniform over solver-namable causes in v0.2 |
| Variant selection | stochastic (seeded) | structural sub-recipes per family |
| Hidden parameters | **pure rule-based** | e.g. conflict worlds build N>associativity distinct lines mapping to one set |
| Honest-truth guard | rule-based check + deterministic re-draw | prevents unfair indistinguishable truths |
| Baseline twin | pure rule-based | known-good variant of same workload for honest before/after |
| Observations at runtime | pure rule-based | simulation kernels re-run on demand |
| Briefing prose | templated | slot-filled from geometry/workload facts; cause-neutral by construction and tested |
| Narrative polish / hint text | optional LLM, later | may rephrase; must not touch hidden, actions, hypotheses, solution |

## Possibility space discipline

The generator cannot produce arbitrary combinations because:

1. **Causes come from a fixed catalogue** with declared mechanism summaries
   and signature classes.
2. **Each cause has per-variant hidden-state recipes**, written so that real
   simulation yields its signature symptom class (verified by
   simulator-honesty tests).
3. **Distractors are other catalogue entries** that are plausible AND
   evidence-separable — never strawmen.
4. **Difficulty changes structure** (see DIFFICULTY_MODEL.md), not prose.

Adding a possibility = adding a catalogue entry + a recipe + honesty tests +
fixtures. Nothing else in the pipeline changes.

## Worked example (`regression-diagnosis`, truth = false-sharing/split-struct)

1. rng draws `false-sharing` from six solver-supported causes;
   `split-struct` from its two variants. Distractors drawn from separable
   classes: spatial-loss, compulsory-churn, phase-change (band 3 keeps 3).
2. Geometry drawn: 32 KiB, 64 B lines, 4-way → 128 sets.
3. Recipe: one cache line at a seed-chosen base; core0 writes word+0, core1
   writes word+32, strictly alternating ×512 → ownership ping-pong with
   zero same-word conflicts; interleaved reads over an 8-line resident
   window (well-cached).
4. Baseline twin: resident-window sweep of identical access count.
5. Actions/hypotheses assembled; solution path declared
   (`perf-counters > coherence-probe`).
6. Validation: solver on path concludes `false-sharing`; prefixes don't;
   coherence probe excludes both sharing modes when traffic is absent;
   multi-path enumeration records alternative solving subsets; ≥1
   distractor refuted.
7. Spec sealed (`pruneUndefined` for JSON fixpoint). Golden seeds pin it
   byte-for-byte.

## Failure handling

Any validation error throws `WorldGenerationError` — the engine returns *no
world* rather than a repaired-looking one. There is deliberately no
auto-repair loop in v0.2: a generation recipe that fails validation is a bug
in the recipe (fix the recipe), not noise to paper over. The honest-truth
guard is the one sanctioned re-draw, because it encodes domain knowledge
about separability rather than papering over a validation failure.
