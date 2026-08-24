# CPU Memory Domain

*The `cpu-memory` domain plugin as of v2.0: causal families, variants,
parameter space, and known limitations.*

## Identity

| Field | Value |
| --- | --- |
| domainId | `cpu-memory` |
| version | 2.0.0 |
| template | `regression-diagnosis` (mode: diagnostic) |
| DAU subjects | `cpu` |

The learner is handed a service whose hot loop regressed after an unrelated
build change. They probe evidence (each probe costs a profiling rerun),
form and freeze hypotheses, and commit to exactly one root cause.

## Causal family catalogue (12 families, 3 signature classes)

All 12 families are fully implemented in the simulator and appear as
plausible hypotheses in worlds.

### conflict class — concentrated set signature

| Family | Variants | Mechanism |
| --- | --- | --- |
| `conflict-miss` | hot-array, strided-collision, struct-padding | Hot lines map onto one cache set; each pass evicts the line the next iteration needs. |
| `associativity-cliff` | one-over, two-over | The cycle touches exactly associativity+1/+2 lines of one set; a tiny working set still misses every time. |
| `phase-change` | late-phase-entry, mid-run-shift | A new phase enters mid-run; early windows healthy, later windows collapse onto a different working set. |

Solver-namable today: `conflict-miss`, `phase-change`. Cliff vs plain
conflict requires an associativity-counterfactual probe (planned).

### cold class — spread-miss signature

| Family | Variants | Mechanism |
| --- | --- | --- |
| `capacity-miss` | sweep-growth, multi-buffer | Working set exceeds cache; sweeps evict lines still needed. |
| `compulsory-miss-surge` | fresh-inputs, rotating-buffers | Loop walks fresh data; nearly all misses are first-touch. |
| `spatial-locality-loss` | gather-scatter, column-walk | Pattern jumps across memory; each line used once. |
| `temporal-locality-loss` | pass-split, interleaved-streams | Reuse distance grew past the cache's reach. |
| `prefetch-storm` | descending-stride, wide-stride | Access order defeats next-line prefetch; dead prefetches crowd the bus. |
| `prefetch-starved` | pointer-chase, random-touch | Scattered pattern stops the prefetcher issuing; formerly-hidden misses land raw. |
| `hierarchy-mismatch` | l1-spill, l2-boundary | Working set crossed a level boundary; L1 hits became L2 accesses. |

Solver-namable today: `compulsory-miss-surge`, `spatial-locality-loss`,
plus `prefetch-storm` / `prefetch-starved` when the evidence separates
them from spatial loss, and `temporal-locality-loss` when reuse is present
but ineffective. Capacity vs churn vs hierarchy share signatures at L1 and
are separated only by planned probes (working-set bound check, L2 counters).

### coherence class — transfer signature

| Family | Variants | Mechanism |
| --- | --- | --- |
| `false-sharing` | adjacent-counters, split-struct | Two cores write *different* words sharing a line; ownership ping-pongs. |
| `true-sharing` | shared-accumulator, hot-lock-data | Both cores write the *same* word; transfers inherent but volume exploded. |

Both solver-namable: separated by same-word share of coherence transfers
(>80% ⇒ true sharing).

### Honest-truth guard

A spatial-loss world whose access pattern defeats the prefetcher is
indistinguishable from a prefetch storm with current probes. Generation
detects this case (`usefulFraction < 0.35` on a spatial variant) and
deterministically re-draws a different truth for that seed. Validation
would reject such worlds anyway; the guard avoids wasted work and keeps
the seed→world mapping stable.

## Evidence channels & probes

| Probe | Cost | Key readings | Excludes (when signature says so) |
| --- | --- | --- | --- |
| perf-counters | 1 | slowdown, L1 miss rate vs baseline | nothing alone (confirms regression) |
| cache-params | 0 | sizes, line, associativity per level | nothing (configuration context) |
| miss-timeline | 1 | shape (flat/rising/falling/bursty), window rates, phase labels+rates | phase-change (single-phase workloads) |
| set-distribution | 1 | set skew, active sets, reuse factor, temporal reuse, footprint, gap pattern | conflict families (low skew) or cold families (concentration); gap extremes separate churn vs spatial loss |
| coherence-probe | 1 | cross-core invalidations, contended lines, same-word conflicts | both sharing families (no traffic) or the opposite sharing mode |
| prefetch-audit | 1 | issued, useful fraction, bus transactions | both prefetch pathologies (healthy) or capacity (defeated) + gap-dependent exclusions |
| prefetch-off-run | 2 | counterfactual cycles with prefetcher off | distinguishes "prefetching was helping" vs hurting |

Probe costs are declared per action; bands ≥3 brief the learner that reruns
are budgeted (budget enforcement is UI-side, see DIFFICULTY_MODEL.md).

## Simulation kernels (`sim.ts`)

- **Set-associative LRU cache** with per-tag hit tracking (`hotTagHits`),
  exact bit-slice set indexing, eviction counting.
- **Windowed miss timeline** with state carried across windows (cold-start
  pollution only in early windows).
- **Two-level hierarchy** walk producing per-level miss rates (honest
  aggregate counters; inclusion is not modelled).
- **Coherence ledger**: alternating writers on lines; tracks cross-core
  invalidations, contended lines, local writes, and **same-word** conflicts
  (the true/false-sharing discriminator).
- **Next-line prefetcher** (degree 1) with on/off policy: issues L+1 per
  demand miss, usefulness = later demand, bus = misses + issued.
- **Cycle estimator** additive over misses×penalty + coherence stalls;
  useful prefetches shorten effective penalty; useless prefetches add bus
  cost. Deliberately simple and explainable.

## Parameter space actually varied by seeds

- geometry: size ∈ {16, 32} KiB × associativity ∈ {2, 4, 8}
- stream length: varies per variant (e.g. conflict streams 1024–1536+
  accesses; compulsory chunks 96–224 lines × 16–28 passes)
- region base addresses (7–15 distinct regions per variant)
- structural knobs: chunk counts, buffer counts, row/col dimensions,
  stride multiples, burst patterns, phase repetitions
- phases: 1–2 per workload (phase-change always 2)

Measured diversity (600-seed audit, band 3): 112 unique structural
fingerprints across 6 truth families; per-family fingerprints 12–34.

## Known simulator limitations

Documented honestly; none are silent:

1. **No inclusive-hierarchy correlation.** Per-level stats are independent
   runs over the same stream (like real per-level counters), not a true
   inclusive/exclusive walk.
2. **No bus-contention feedback loop.** Useless prefetches add fixed bus
   cost rather than slowing concurrent misses.
3. **Prefetcher is degree-1 next-line only.** No stride prefetcher,
   no confidence counters — so "storm" means *this specific policy*
   defeated, not arbitrary prefetcher misbehaviour.
4. **Single-cycle issue model.** No OoO overlap, MLP, or store buffering;
   the cycle estimator is CPI-stall arithmetic.
5. **Coherence is a ledger, not a protocol run.** No MESI state machine;
   invalidation counts derive from writer alternation. Same-word tracking
   is what makes true/false sharing separable — it is not faked.
6. **TLB/NUMA not modelled.** Deliberately omitted rather than fake-countered
   (see brief's constraint).
7. **Noise field exists but is `none` in v2.** Sampling-noise injection is
   scaffolded (`noise.magnitude`) but disabled until justified against the
   "random noise is not difficulty" rule.

## Planned separating probes (unlock the remaining truths)

| Probe | Unlocks |
| --- | --- |
| assoc-halve-run (counterfactual, NOT YET IMPLEMENTED) | associativity-cliff vs conflict-miss |
| working-set-vs-capacity bound report | capacity-miss vs compulsory-churn |
| prefetch-off counterfactual wired into solver | storm/starved vs spatial loss |
| per-level (L2) counters in observations | hierarchy-mismatch vs temporal loss |
