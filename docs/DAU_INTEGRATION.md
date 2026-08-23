# DAU Integration

*How worlds reach learners, what crosses the boundary, and who owns what.*

## Boundary in one line

Worlds are practice. DAU is truth. A world session returns **lightweight
evidence that diagnosis was attempted and its outcome** — never mastery,
never scheduling, never progression decisions.

## Transport today

The canonical Practice Labs handshake, unchanged:

```
DAU lesson / catalog
  → encodePracticeRequest({
      schemaVersion: 1,
      sourceApp: "dead-air-university",
      labId: "world-generator",
      conceptId: <primary concept>,       e.g. "cpu-cache-miss"
      lessonId: "{conceptId}-20",
      practiceType: "world-diagnosis",
      goal: <world objective>,
      parameters: {
        domainId: "cpu-memory",
        templateId: "regression-diagnosis",
        seed: "seed-1234",               // world coordinates travel in parameters
        difficultyBand: 3
      }
    })
  → open world UI at ...?practice=<url-safe-base64-json>

world UI → postMessage(opener, { type: "dau:practice-result", result })
```

The result envelope carries structured outcome data inside `metadata`
(keys ≤64 chars, primitive values — within the canonical schema):

```jsonc
{
  "schemaVersion": 1, "labId": "world-generator",
  "conceptId": "cpu-cache-miss", "lessonId": "cpu-cache-miss-20",
  "completed": true, "attempts": 1, "timeSpentMs": 612000, "selfRating": 4,
  "metadata": {
    "template": "regression-diagnosis", "seed": "seed-1234",
    "correct": true, "probes": 4, "hints": 0,
    "firstPredictOk": null, "band": 3
  }
}
```

`template + seed` make any recorded session replayable forever; `probes`,
`correct`, and `firstPredictOk` are the pedagogically interesting signals.

## Ownership table

| Concern | Owner |
| --- | --- |
| Curriculum, concept ids, prerequisites | DAU (canonical manifests) |
| Mastery, SRS, placement, progression | DAU only |
| World possibility space, generation, validation | World Generator |
| World session state | World Generator (ephemeral, browser-local) |
| Practice evidence records | DAU (when it chooses to store them) |

## What DAU must do to consume worlds (later work, not ours to force)

1. Registry row for `world-generator` (status `implemented-external`,
   coverage by concept patterns) — pending the contract-repo audit settling.
2. Optional: record result metadata into progress as observational evidence
   (the export-schema v2 deliberately has no practice fields yet — extending
   it is a DAU-side decision).
3. Optional: launch points from lessons whose concepts match a world's
   `concepts` list.

Nothing in the current DAU codebase needs to change for the standalone
product to function; integration degrades gracefully to "learner opens the
UI and enters a seed".

## Anti-fork guarantees

- Concept ids are copied from canonical manifests and verified by tests;
  worlds never define their own technical truths.
- The engine refuses unsolvable/contradictory worlds before exposure, so a
  learner can never internalise an unvalidated causal story.
- Canonical explanations come from ground-truth simulation summaries, not
  generated prose — no second source of curriculum narrative.
