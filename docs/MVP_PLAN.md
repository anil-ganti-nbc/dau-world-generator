# MVP Plan

*What the first real implementation contains, what it must prove, and in
what order to build it.*

## MVP thesis

Prove that a generated world can be **causal, reproducible, validated, and
genuinely educational** in exactly one domain — and that it reaches learners
through the existing Practice Labs contract. Everything else waits.

## First domain: cpu-memory (rationale)

1. **Curriculum fit.** `cpu` has 77 concepts with a clean tier ladder;
   cache behaviour sits at tiers 2–3 where DAU's audience concentrates.
2. **Simulable physics.** Set-associative caches are small, exact,
   deterministic programs — causality is cheap to honour honestly.
3. **Rich plausible confusions.** Conflict/capacity/coherence/prefetch are
   genuinely confusable, which makes real diagnostic worlds possible rather
   than disguised quizzes.
4. **Transfer value.** Perf-counter literacy transfers directly to the
   learner's actual machines.

(Chosen over OS/networking/semis: those need multi-entity state or
statistical models first; their strongest worlds arrive one plugin-pattern
repetition later.)

## Shipped vertical slice (this repo, v0.1)

- [x] Deterministic engine + RNG discipline (byte-identical regeneration)
- [x] WorldSpec v1 model + JSON schemas
- [x] DomainPlugin contract (5 functions)
- [x] `cpu-memory/regression-diagnosis`: 4 causes × seeded recipes
- [x] Simulation kernels: set-assoc LRU (+windows), coherence ledger, prefetch model, cycle estimator
- [x] Validation: structural invariants + solver-based solvability + no-early-solve + distractor refutability
- [x] 60-seed bulk-solve gate; single-probe discipline gate; briefing neutrality gate
- [x] Golden fixtures per cause (CI-pinned)
- [x] Practice Labs contract conformance (request/result round-trip)
- [x] Minimal investigation UI incl. `?practice=` payload entry
- [x] Playwright e2e of the full loop

## Next increments (in order)

**v0.2 — deepen the proven domain**
1. Bands 4–5 for regression-diagnosis: mixed signatures, metered probe budgets.
2. Predictive sub-mode: same hidden machinery, learner freezes a prediction
   about a *proposed* change before the modified stream runs.
3. Hint ladder keyed to committed-wrong-hypothesis (which distractor and why
   its evidence was misread).
4. Session journal + replay file format.

**v0.3 — second domain (plugin-pattern proof)**
- `os/scheduler-triage` (pilot #9): priority inversion vs deadlock vs
  saturation; process table + lock graph evidence. Proves the contract works
  outside its birthplace; revisit any core assumptions it strains.

**v0.4 — integration hardening**
- Contract-side registry row once the dau-practice-labs audit settles;
  upstream per-lab adapter pattern if wanted by the labs' maintainers.
- Optional practice-evidence fields proposal for export-schema v3 (DAU-owned).
- Difficulty calibration data collection behind an opt-in flag.

**v1.0 — pilot catalogue breadth**
- Networking (`packet-flow`) and compilers (`pass-bisect`) plugins; pilots
  5–8. Multi-domain worlds explicitly out of scope until four domains hold.

## Explicit non-goals for MVP

- No LLM anywhere in generation or grading paths.
- No accounts, backend, cloud sync (browser-local only).
- No authoring UI for templates (code-first).
- No mobile layout work beyond "usable".
- No modification of DAU or lab repos (audit caveat respected).

## Success criteria for MVP acceptance

1. A learner who has never seen the system can complete a band-3 world
   unaided in ≤30 minutes (e2e + human smoke).
2. Every shipped seed solves via the declared path and no seed solves via a
   single probe (automated, CI-enforced).
3. Regeneration from seeds is byte-stable across machines (fixtures + CI on
   two platforms).
4. The result envelope lands in DAU's inbox shape without DAU changes.
5. A domain expert review of kernel fidelity passes for cpu-memory
   (scheduled, not yet run — tracked as open item).
