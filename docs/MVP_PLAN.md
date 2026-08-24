# MVP Plan

*What the first real implementation contains, what it must prove, and in
what order to build it.*

## MVP thesis

Prove that a generated world can be **causal, reproducible, validated, and
genuinely educational** in exactly one domain — and that the domain is
*genuinely generative*, not a handful of disguised templates. Everything
else waits.

## First domain: cpu-memory (rationale)

1. **Curriculum fit.** `cpu` has 77 concepts with a clean tier ladder;
   cache behaviour sits at tiers 2–3 where DAU's audience concentrates.
2. **Simulable physics.** Set-associative caches are small, exact,
   deterministic programs — causality is cheap to honour honestly.
3. **Rich plausible confusions.** Twelve causal families across three
   signature classes are genuinely confusable, which makes real diagnostic
   worlds possible rather than quizzes in costume.
4. **Transfer value.** Perf-counter literacy transfers directly to the
   learner's actual machines.

## Shipped vertical slice (v0.2)

- [x] Deterministic engine + RNG discipline (byte-identical regeneration)
- [x] WorldSpec v1 model + JSON schemas (world, world-result, domain-manifest)
- [x] DomainPlugin contract (5 functions)
- [x] `cpu-memory/regression-diagnosis`: **12 causal families × 25 structural
      variants**, geometry/region/stream parameter draws
- [x] Simulation kernels: set-assoc LRU (+windows), two-level hierarchy walk,
      coherence ledger with same-word tracking, next-line prefetcher with
      on/off counterfactual policy, cycle estimator
- [x] Validation: structural invariants + solver-based solvability +
      no-early-solve + distractor refutation + non-diagnostic rejection +
      multi-path discovery
- [x] Honest-truth guard: indistinguishable truth variants are re-drawn
- [x] Seed-fuzz property tests P1–P9 (300-seed main sweep + 100 per band)
- [x] Full fuzz statistics: 750 seeds × all bands, zero failures; 2500-seed
      confirmation run recorded in fixtures/seedfuzz-results.json
- [x] Golden fixtures: representative worlds per solver-supported family at
      bands 2 and 4 (12 pinned worlds)
- [x] Practice Labs contract conformance (request/result round-trip)
- [x] Minimal investigation UI incl. `?practice=` payload entry
- [x] Playwright e2e of the full loop

## Next increments

**v0.3 — separating probes (unlock remaining truths)**
1. assoc-halve-run wired into solver → grades associativity-cliff truths.
2. Working-set-vs-capacity bound report → grades capacity-miss truths.
3. prefetch-off-run wired into solver → grades storm/starved separately
   from spatial loss.
4. L2 counters surfaced in observations → grades hierarchy-mismatch.

**v0.4 — predictive sub-mode**
Same hidden machinery; learner freezes a prediction about a *proposed*
change before the modified stream runs. Mandatory freeze before reveal.

**v0.5 — hint ladder + misconception targeting**
Hints keyed to committed-wrong-hypothesis (which distractor and why its
evidence was misread), reusing DAU's typed distractor taxonomy.

**v0.6 — second domain (`os/scheduler-triage`)**
Priority inversion vs deadlock vs saturation; proves the plugin contract
outside its birthplace before any core generalisation.

**v1.0 — pilot catalogue breadth**
Networking (`packet-flow`) and compilers (`pass-bisect`) plugins. Multi-
domain worlds explicitly out of scope until four domains hold.

## Explicit non-goals for MVP

- No LLM anywhere in generation or grading paths.
- No accounts, backend, cloud sync (browser-local only).
- No authoring UI for templates (code-first).
- No mobile layout work beyond "usable".
- No modification of DAU or lab repos (audit caveat respected).

## Success criteria for MVP acceptance

1. A learner who has never seen the system can complete a band-3 world
   unaided in ≤30 minutes (e2e + human smoke).
2. Every shipped seed solves via its declared path AND via ≥3 alternative
   paths; no seed solves from any single probe (automated, CI-enforced).
3. Regeneration from seeds is byte-stable (fixtures + CI on two platforms).
4. The result envelope lands in DAU's inbox shape without DAU changes.
5. Seed-fuzz over ≥2500 seeds shows 0 generation failures, 0 unsolvable
   worlds, 0 early reveals, 0 non-diagnostic worlds.
6. A domain expert review of kernel fidelity passes for cpu-memory
   (scheduled, not yet run — tracked as open item).

Items 2 and 5 are met today by automated runs; item 1 awaits human smoke;
item 6 remains open.
