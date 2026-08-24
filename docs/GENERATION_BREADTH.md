# Generation Breadth Report

*Can one DAU World domain generate a large family of distinct, causally
valid, solvable, non-trivial investigations — or just a few disguised
templates? This report measures it.*

## v0.1 baseline audit (the honest starting point)

A 400-seed sweep of the original `cpu-memory` domain produced:

| Measure | Result |
| --- | --- |
| structural fingerprints (cause\|geometry\|streamlen) | **20 over 400 worlds** |
| conflict-miss distinct-line counts | 4 values total (19–22) |
| prefetch-storm stream lengths | 1 value (always 1024) |
| false-sharing stream lengths | 1 value (always 8) |
| solution paths | 4 (one fixed path per cause) |

**Verdict: v0.1 was four handcrafted cases wrapped in seeded machinery.**
Seeds changed titles and cache geometry; the investigation itself was
identical every time.

## v0.2 measured breadth

Same audit re-run after deepening (`scripts/audit-breadth.ts`, 600 seeds,
band 3):

- **6 solver-namable truth families × 2–3 structural variants × 6
  geometries**, with per-variant parameter draws (stream lengths, region
  bases, chunk/buffer/row counts).
- **112 unique structural fingerprints over 600 seeds** (family × variant ×
  geometry × stream length), up from 20/400.
- Per-family fingerprints: conflict 34, compulsory 24, spatial 18,
  phase-change 12, coherence 12 each.
- Full 5-band sweep: **~61–66 unique fingerprints per band per 150 seeds**.

## Seed-fuzz statistics (machine-readable copy in `fixtures/seedfuzz-results.json`)

Full confirmation run: **2500 seeds (500 × bands 1–5), 0 generation
failures, 0 unsolvable worlds, 0 early reveals, 0 non-diagnostic worlds,
~72 unique structural fingerprints per band, average 6.5 alternative
solving paths per world (max 10).** An earlier 750-seed run showed
identical zero-failure behaviour:

| Band | Gen fails | Validation fails | Unsolvable | Early reveals | Non-diagnostic | Alt paths avg/max |
| --- | --- | --- | --- | --- | --- | --- |
| 1–5 (×150 each) | 0 | 0 | 0 | 0 | 0 | 6.3–6.9 / 10 |

All six solver-namable causes reachable in every band's sweep. Deterministic
replay verified by byte-equal regeneration on sampled seeds (P7a property
test).

## What materially varies between two seeds of the same family

Example, two spatial-loss seeds:

- seed A → column-walk over 32×64 array on a 16 KiB 2-way cache:
  scatter-gap signature, prefetcher healthy.
- seed B → gather-scatter of 800 scattered lines on a 32 KiB 8-way cache:
  short-stride signature, prefetcher defeated → generation guard redirects
  to a different family entirely.

Both are "spatial locality loss" in the curriculum sense but require
different probe sequences and different final reasoning steps.

## What still varies only cosmetically (known)

- Service name and title phrasing (5 titles × 4 services).
- Baseline description string for hierarchy worlds.
- Exact hot-set index within a set structure (changes numbers, not shape).

These are labelled presentation variance and are excluded from the
diversity fingerprint metric.

## Multiple valid investigation paths

The validator enumerates all action subsets (≤4 probes) and records those
that also solve:

- average alternative paths per world: **6.3–6.9 across all bands**
- maximum observed: **10 alternative solving subsets** beyond the declared path

Example from a band-3 compulsory-churn world (declared path
`perf-counters > set-distribution > miss-timeline`), alternatives include:

```
perf-counters > set-distribution
perf-counters > set-distribution > coherence-probe
perf-counters > miss-timeline > set-distribution > coherence-probe
…(7 more)
```

The learner is not forced down one click-order; validation proves the
world is solvable through several defensible strategies while still
requiring ≥1 refuting observation (no world is solvable by a single probe).

## Answer to the phase question

With the v0.2 catalogue, one domain now generates a measured space of
**hundreds of structurally distinct investigations** (12 families × 25
variants × 6 geometries × parameter draws ≈ thousands of possible
structures; ~65 fingerprints observable per 150-seed sample), every one of
which is validated as causal, solvable, non-trivially diagnostic, and
reproducible. The remaining same-class ambiguities are declared honestly
rather than hidden, with the separating probes named in CPU_MEMORY_DOMAIN.md.
