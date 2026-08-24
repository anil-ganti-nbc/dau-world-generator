# Validation Model

*A world does not ship because the generator produced it. It ships because
it survived checks that do not trust the generator.*

## Principle: generation and validation are different authorities

`generate()` may never call its own solver to certify itself. Concretely:
the engine runs `validateWorldStructure()` + `solveCheck()` on the assembled
spec, and `solveCheck` drives the plugin's **independent solver** over
learner-visible evidence only. The solver is written against observation
readings (strings/numbers), never hidden state — if the hidden model drifts
from the evidence model, validation breaks loudly.

## Layer 1 — structural invariants (`validateWorldStructure`, always run)

- schemaVersion is 1; templateId is `domain/template`; seed non-empty.
- ≥1 concept reference; prerequisites reference exercised concepts (warning).
- **Exactly one** hypothesis has `isTrue`.
- `solution.correctHypothesisId` equals the flagged true hypothesis.
- ≥2 distractors above band 1.
- Every declared discriminating action exists in `actions`.
- `actions.length ≥ difficulty.minInvestigations + 1`.

## Layer 2 — solver checks (`solveCheck`, always run at generation)

1. **Solvability.** The independent solver, fed exactly the declared
   discriminating-action observations, must conclude the true cause.
   Otherwise: error `unsolvable`, world refused.
2. **No early solve.** Prefixes of the path must not already conclude the
   truth (`early-solve` warning; recorded as `earlySolveAt` in the report).
3. **Multi-path discovery.** Every action subset of size ≤4 is tested;
   subsets that solve WITHOUT containing the declared path count as
   DISTINCT alternative strategies (`alternativePaths`); supersets of the
   declared path are padding (same reasoning plus wasted probes) and are
   counted only in `solvingSubsetsTotal`. This makes "multiple valid
   investigation strategies" a measured, distinctness-weighted property.
4. **Distractor refutation.** Over the FULL learner-visible action set:
   - every distractor must be excluded by some observation's
     `discriminatesAgainst`, or be explicitly declared `unrefutable`
     (same signature class);
   - at least one distractor must be refuted somewhere, else error
     `non-discriminating` — a world where nothing is ever excluded is not
     a diagnosis.

## Layer 3 — test-suite gates (CI)

| Gate | What it proves |
| --- | --- |
| Determinism | same seed ⇒ deep-equal spec |
| Bulk solve | 60 seeds: solver lands on truth every time; all causes reachable |
| Partial-path discipline | single probes never give the answer away (30 seeds × all actions) |
| Briefing neutrality | briefing never names any distractor's label |
| JSON fixpoint | specs survive `JSON.parse(JSON.stringify(...))` unchanged |
| Golden fixtures | representative worlds per family × band regenerate byte-identically and still solve |
| Simulator honesty | kernels reproduce the phenomena themselves (conflicts concentrate set misses, writers ping-pong ownership, strides defeat prefetch) |
| Contract conformance | worlds round-trip through canonical dau-practice-labs request/result schemas |
| Seed fuzz | 300-seed band sweep + 100 seeds per other band asserting P1–P9 (see tests/seedfuzz.test.ts) |
| Kernel mutations | seeded corruptions of coherence/prefetch/timeline/set-index/counter channels (tests/kernel-mutation.test.ts); each attack must end in rejection or bounded, documented residual — never silent mis-grading |
| Reading truthfulness | sampled readings recomputed through independent mini-implementations (LRU, prefetch, coherence ledger) must match shipped observations (tests/reading-truthfulness.test.ts). Proves the instrument is honest — NOT that the physics is real (that is the SME gate) |
| SME inventory gate | kernel-rule inventory parses, covers all evidence channels, no anonymous sign-offs, gate status consistent with per-rule verdicts (tests/kernel-inventory.test.ts) |

### Seed-fuzz properties (P1–P9)

P1 no generation throws · P2 structural validation passes · P3 declared
path solves · P4 no single probe reveals the answer · P5 all distractors
refuted or declared · P6 ≥1 distractor refuted (world is diagnostic) ·
P7 byte-reproducible regeneration + cross-seed diversity · P8 JSON fixpoint
· P9 all solver-supported causes reachable.

## Layer 4 — adversarial passes (planned, not yet built)

- **Solver-vs-solver fuzzing:** a second, differently-implemented solver
  run over large seed batches; disagreement flags ambiguous evidence.
- **LLM attack pass:** an LLM given briefing + hypotheses + evidence judges
  *difficulty* only, never truth.
- **Difficulty calibration:** probe counts and wrong-commit patterns vs
  declared bands.

## Honest ambiguity policy

Some same-class hypotheses cannot be separated by current probes (e.g.
conflict vs associativity-cliff without a counterfactual run). The model
does not pretend otherwise:

- such families are documented as not-yet-gradable truths
  (`SOLVER_SUPPORTED`);
- generation's honest-truth guard re-draws when a chosen variant would be
  indistinguishable from a sibling;
- the `unrefutable` hypothesis flag is now SET by generation: any distractor
  sharing the truth's signature class is declared unrefutable, and validation
  enforces both directions (declared ⇒ actually survives all evidence;
  surviving ⇒ must be declared). A future UI can surface "cannot be excluded"
  honestly instead of faking refutation.

## Semantic-truth caveat

Automated checks prove internal consistency (evidence follows from state;
state matches the claimed cause class). They cannot prove the *domain
model* is technically faithful. That burden sits on simulator-honesty
tests plus curriculum-source grounding of each kernel, and eventually SME
review recorded per domain version. This limit is stated rather than hidden.
