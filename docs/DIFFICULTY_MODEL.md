# Difficulty Model

*Difficulty is the cost of the reasoning a world demands — never the opacity
of its prose. This document describes the dimensions as actually implemented
in `cpu-memory` v2.0 and shows measured easy-vs-hard differences.*

## Implemented dimensions

| Dimension | Where it lives in code | Band effect |
| --- | --- | --- |
| plausible hypotheses | `separableAlternatives` count → distractor set size | band 1: 1 distractor · band 2: ≤2 · bands 3–5: 3 |
| relevant variables | `DifficultyProfile.relevantVariables` = 3 + distractors + phase count — **DERIVED, not measured** | grows with hypotheses and multi-phase workloads |
| causal depth | `causalDepth` = min(3, 1 + ⌊band/2⌋) — **DERIVED, not measured** | band 1–2: direct symptom→cause; band ≥3: evidence-chain (distribution ⇒ prefetch ⇒ cause) |
| observability | `observability` = 0.85 − 0.08×band — **DERIVED, not measured**; no validation inspects it | higher bands derive more readings indirectly (skew ratios vs raw counters) |

> **Honesty note (post-review):** only `distractorHypotheses` and
> `minInvestigations` are backed by validation. The three derived fields
> above describe the generation *recipe*, not the built world, and must not
> be quoted as measured difficulty properties until a calibration loop
> replaces them with telemetry-derived values.
| min investigations | `minInvestigations` = 2 (band <3) / 3 (band ≥3), bounded by action count | longer declared paths at high bands |
| interacting effects | phase-change families always 2 phases; counterfactual probes gated to band ≥4 | conditional reasoning ("distribution spread, so now check prefetch") |
| probe budget pressure | briefing declares budgeted reruns for band ≥3; costs declared per action (1 or 2) | deliberate probe choice becomes part of the game |
| indirectness of symptoms | variant recipes: hot-set worlds are direct; interleaved/pass-split worlds need reuse-distance reasoning | later variants in each family are harder |

## What difficulty is explicitly NOT

- Confusing prose (briefings stay plain; a fixed template).
- Random noise (the `noise` field exists but is `none`; see
  CPU_MEMORY_DOMAIN.md limitation 7).
- Hidden-information gotchas: nothing needed for diagnosis is withheld.
- Volume: more tabs of irrelevant data is not difficulty.

## Measured easy-vs-hard differences

From the 750-seed fuzz sweep (`fixtures/seedfuzz-results.json`):

| Signal | Band 1–2 | Band 4–5 |
| --- | --- | --- |
| distractor hypotheses | 1–2 | 3 |
| declared path length | 2 probes | 3 probes |
| min investigations | 2 | 3 |
| observability | 0.69–0.77 | 0.53–0.61 |
| multi-phase workloads possible | rare (only phase-change truths) | same family mix, deeper variants |

Concrete example pair (same domain, same template):

**Easy (band 1, conflict-miss):** one distractor; the miss-timeline alone
shows concentration; two probes suffice. The reasoning chain is
"regression confirmed → skew 22× → conflicts".

**Hard (band 5, false-sharing with bursty writers):** three distractors
including both sharing modes; requires perf-counters → coherence-probe,
then reading the same-word share correctly (>80% ⇒ true sharing); the
distracting capacity/spatial hypotheses must be excluded via the timeline's
phase labels and the set distribution before the coherence numbers make
sense. Three probes minimum, four recommended.

The structural difference is verifiable: harder seeds have strictly more
hypotheses alive after the first probe, and their discriminating evidence
is split across more actions (see VALIDATION_MODEL.md alternative-path
counts).

## Calibration loop (planned)

Record per session: probes used, path shape, wrong commits and which
distractor was chosen, time-to-freeze, hint usage. Feed back into band
definitions per domain, `minInvestigations` realism, and which distractors
actually fool whom (misconception targeting — reusing DAU's typed
distractor taxonomy). Bands stay structural; only calibration moves.
