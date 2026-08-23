# Difficulty Model

*Difficulty is the cost of the reasoning a world demands — never the opacity
of its prose.*

## The dimensions

| Dimension | Meaning | Knobs that move it |
| --- | --- | --- |
| `relevantVariables` | state variables that actually matter | more interacting parameters per cause |
| `distractorHypotheses` | plausible wrong explanations alive at commit time | keep more catalogue causes plausible; weaken early discriminators |
| `causalDepth` | steps between root cause and headline symptom | intermediate effects (storm → bus contention → latency) instead of direct ones |
| `observability` | fraction of truth-relevant variables directly observable | replace direct counters with derived/aggregate evidence |
| `minInvestigations` | probes a competent solver needs | longer discriminating paths; evidence spread across actions |
| investigation cost | price per probe (budget pressure) | metered probe budgets; costly-but-decisive vs cheap-but-vague probes |
| prerequisite depth | curriculum distance of required concepts | template selection against learner's demonstrated frontier |
| cross-domain demand | concepts from >1 track | strictly later; multi-domain worlds only |

## Band mapping (current, cpu-memory)

| Band | Structure |
| --- | --- |
| 1 | 1 distractor; direct decisive evidence; 2-probe path |
| 2 | 3 distractors; clear signatures |
| 3 | 3 distractors; requires distribution-level evidence (set skew, prefetch usefulness) to separate cause families |
| 4–5 (reserved) | subtler signatures (mixed conflict+capacity), delayed effects, competing causes both partially true until cost analysis, metered probe budgets |

The profile recorded on each world states what was *actually built*, and
validation checks claims against the spec rather than trusting intent.

## What difficulty is explicitly not

- **Confusing prose.** Briefings stay plain; complexity lives in the system.
- **Random noise.** No jitter added to readings to fake uncertainty
  (measurement noise may later be modelled *causally* — e.g. sampling error
  proportional to window size — but it must follow from state).
- **Hidden-information gotchas.** Nothing needed for the diagnosis is
  withheld; the cost is in *choosing which evidence to buy*, not guessing
  what exists.
- **Volume.** More tabs of irrelevant data is not harder, just longer.

## Difficulty as discrimination cost

The unifying frame: **difficulty = how much discriminating evidence separates
the true cause from each distractor.**

- Easy: one cheap observation splits the hypothesis space.
- Medium: two observations; second depends on reading the first.
- Hard: several observations with conditional dependencies ("distribution was
  spread, so now check whether prefetch was defeated"), plus distractors whose
  signatures overlap on every single probe.

This gives a measurable target for generation: minimise max-over-distractors
of "evidence distance", then scale that minimum with band. The partial-path
checks in validation are the first instrumentation of this idea.

## Calibration loop (planned)

Record per session: probes used, path shape, wrong commits and which
distractor was chosen, time to freeze, hint usage. Feed back into:
band definitions per domain, `minInvestigations` realism, and which
distractors actually fool whom (misconception targeting — reusing DAU's typed
distractor taxonomy). Bands stay structural; only their calibration moves.
