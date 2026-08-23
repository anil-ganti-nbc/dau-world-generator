# Learner Interaction Model

*The conceptual UX of investigating a world: what learners do, what the
system does in response, and how brute-forcing is designed out.*

## The core loop

```
read briefing → form hypotheses → choose evidence (spend probes)
     ↑                                        ↓
     └── revise model ← observe results ←─────┘
                  → freeze prediction → commit diagnosis
                  → verdict + canonical explanation
```

## Action vocabulary

| Action | v1 status | Notes |
| --- | --- | --- |
| inspect / measure | shipped | read-only evidence; free re-reads of already-probed actions |
| compare | shipped (implicit) | baseline-vs-current pairs built into readings |
| predict (freeze) | shipped | freeze a hypothesis before committing; timestamped |
| commit diagnosis | shipped | graded against ground truth |
| run / step | later | advance simulated time (predictive/failure-injection modes) |
| change / configure | later | mutate hidden state via deterministic recipes |
| annotate hypothesis | later | attach reasoning to a freeze (feeds misconception targeting) |
| request hint | later | ladder keyed to committed-wrong hypotheses |

## Design rules

**Evidence costs attention, not clicks.** Probing is unlimited but every
probe adds a reading the learner must reconcile. Re-probing replaces rather
than duplicates — the log stays a coherent narrative of what was learned.

**Freeze-before-reveal where it matters.** For diagnostic worlds the freeze
is lightweight: pick a hypothesis any time; committing grades it. For
predictive worlds (v0.2) freezing becomes mandatory — the prediction is
timestamped before the modified system runs, preserving the honest "I was
wrong" moment that drives model revision.

**Wrong models must become observable.** Every distractor has evidence that
refutes it. A learner who commits `capacity-miss` in a conflict world sees
exactly which reading should have stopped them (set skew vs spread), so the
verdict teaches rather than merely scores.

**No trivial brute force.** Three guards:
1. *No lucky single probe* — validation refuses worlds solvable from one
   action's evidence (enforced for band ≥2).
2. *Commit has no undo* — attempts are counted and returned as evidence;
   shotgunning hypotheses is visible to DAU.
3. *Probe budget pressure* (bands 4–5, planned) — each probe costs from a
   metered budget; random probing exhausts it before discriminating evidence
   accumulates.

Guessing is never *blocked* — it's just always more expensive than thinking.

## Diagnosis ≠ explanation

The learner commits while their own model is still load-bearing. Only after
commit does the canonical explanation appear, generated from ground truth.
Before that point the system never confirms or denies any hypothesis —
including through UI copy (hypothesis cards are cause-neutral).

## Session shape

```jsonc
{
  "spec": { "templateId": "...", "seed": "..." },   // replay coordinates
  "actions": ["perf-counters", "set-distribution"], // ordered probes
  "frozen": ["capacity-miss", null],                // prediction timeline
  "committed": "conflict-miss",                     // final answer + when
  "correct": true,
  "probesUsed": 4
}
```

Fully deterministic given the seed ⇒ every session is replayable for review,
hinting, or research.
