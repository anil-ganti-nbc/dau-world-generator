# Validation Model

*A world does not ship because the generator produced it. It ships because it
survived checks that do not trust the generator.*

## Principle: generation and validation are different authorities

The same code path must never both create a world and declare it correct.
Concretely: `generate()` may not call `solve()`; validation drives the
plugin's independent solver over learner-visible evidence only, plus
structural invariants over the sealed spec. The solver is deliberately
implemented against observations (strings/numbers), not hidden state — if the
hidden model drifts from the evidence model, validation breaks loudly.

## Layer 1 — structural invariants (`validateWorldStructure`, always run)

- schemaVersion is 1; templateId is `domain/template`; seed non-empty.
- ≥1 concept reference; prerequisites reference exercised concepts (warning).
- **Exactly one** hypothesis has `isTrue`.
- `solution.correctHypothesisId` equals the flagged true hypothesis.
- ≥2 distractors above band 1; distractor count consistent with profile.
- Every declared discriminating action exists in `actions`.
- `actions.length ≥ difficulty.minInvestigations`.

## Layer 2 — solver checks (`solveCheck`, always run at generation)

1. **Solvability.** The plugin solver, fed exactly the declared
   discriminating-action observations, must conclude the true cause.
   Otherwise: error `unsolvable`, world refused.
2. **No early solve.** Every strict prefix of the path must NOT already
   conclude the cause (warnings today; a band-dependent hard gate later).
   This enforces "reasoning, not lucky guessing".
3. **Distractor refutability.** After the full path, every distractor must be
   either explicitly marked refuted by some observation
   (`discriminatesAgainst`) or implicitly eliminated by the solver landing
   uniquely on truth. Refused as `distractor-unrefuted` otherwise.

## Layer 3 — test-suite gates (CI)

| Gate | What it proves |
| --- | --- |
| Determinism | same seed ⇒ deep-equal spec; different seed ⇒ different parameters |
| Bulk solve | 60 seeds × all four causes: solver lands on truth every time; all causes reachable across seeds |
| Partial-path discipline | 30 seeds: single-probe prefixes never give the answer away |
| Briefing neutrality | briefing never names any distractor's label |
| JSON fixpoint | specs survive `JSON.parse(JSON.stringify(...))` unchanged |
| Golden fixtures | pinned worlds regenerate byte-identically; still validate + solve after any change |
| Simulator honesty | kernels reproduce the phenomena themselves (conflict streams concentrate set misses; alternating writers ping-pong ownership; descending strides defeat next-line prefetch) |
| Contract conformance | worlds round-trip through canonical dau-practice-labs request/result schemas |

## Layer 4 — adversarial passes (planned, not yet built)

- **Solver-vs-solver fuzzing:** a second, differently-implemented solver per
  domain (e.g. exhaustive hypothesis scoring) run over large seed batches;
  disagreement between solvers flags worlds whose evidence is ambiguous to
  competent-but-different reasoners.
- **LLM attack pass:** an LLM given briefing + hypotheses + full evidence,
  asked to diagnose without tools; systematically wrong answers flag worlds
  where evidence synthesis requires knowledge the curriculum hasn't taught.
  (The LLM judges *difficulty*, never truth.)
- **Difficulty calibration:** human-in-the-loop probe counts and time-to-commit
  vs the declared `minInvestigations` and band; recalibrate bands from data.

## Invariants worth restating

- The engine returns no world on any error-severity issue — there is no
  "ship with warnings" path for errors.
- Reproducibility means *byte-for-byte*, including hidden state, so any
  behavioural change is forced through fixture updates consciously.
- Validation artifacts (solving paths) are retained with fixtures so future
  changes can diff *why* a world stopped solving, not just that it did.

## Semantic-truth caveat

Automated checks prove internal consistency (evidence follows from state;
state matches the claimed cause class). They cannot prove the *domain model*
is technically faithful — that a simulated 4-way LRU behaves like real
hardware. That burden sits on simulator-honesty tests plus curriculum-source
grounding of each kernel, and eventually on SME review recorded per domain
version. This limit is stated rather than hidden.
