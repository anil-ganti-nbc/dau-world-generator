> **Authoritative copy:** Worlds now live natively in
> [idle-time-learning-doodad](https://github.com/anil-ganti-nbc/idle-time-learning-doodad)
> (`src/worlds`, commit `559507307414a32d146e51d1459bdff0e73baa0f` on
> `feature/native-worlds`). This repository is **historical provenance**.
> Do not gut it. New engine work should land in canonical DAU.

# DAU World Generator

**Causal, seeded, validated diagnostic worlds for [Dead Air University](https://github.com/anil-ganti-nbc/idle-time-learning-doodad).**

A DAU World is a generated technical situation with hidden causes, observable
evidence, available actions, and consequences. Instead of asking the learner a
question, it hands them a system and requires them to work out what is
happening.

```
world state → system rules → observable evidence
```

The evidence **follows from** the hidden state — a world that claims conflict
misses contains an actual set-associative cache simulation that really evicts
hot lines. No LLM decides what is true. Every world is reproducible from its
seed and is refused by the engine unless an independent solver can solve it.

## Status

v0.2 deepened vertical slice: one domain (`cpu-memory`), one template
(`regression-diagnosis`), **12 causal families × 25 structural variants**,
multi-level cache + coherence + prefetch simulation kernels, full validation
harness with multi-path discovery, Practice Labs contract conformance,
golden fixtures per family, seed-fuzz property tests over thousands of
seeds, minimal UI.

```bash
npm install
npm test        # 50 tests incl. seed-fuzz sweeps (hundreds of seeds)
npm run dev     # investigation UI on :8097 (also accepts ?practice= payloads)
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/seedfuzz.ts 500
                # full fuzz sweep → fixtures/seedfuzz-results.json
```

## What lives here

```
docs/                 architecture documents (start with WORLD_GENERATOR_VISION.md)
schemas/              versioned JSON schemas for worlds, results, domain manifests
src/core/             engine, world model, validation, seeded RNG, plugin contract
src/domains/          domain plugins (cpu-memory ships today)
src/adapter/          dau-practice-labs contract adapter
fixtures/worlds/      golden worlds pinned byte-for-byte to their seeds
fixtures/seedfuzz-results.json   machine-readable fuzz statistics
tests/                unit + conformance + golden + simulator-honesty + seed-fuzz tests
scripts/              fixture generation, fuzz sweeps, e2e smoke
```

## The short version of the design

- **DAU owns learning state.** This repo returns lightweight practice evidence
  through the canonical `dau-practice-labs` contract. No mastery, no SRS, no
  progression.
- **Domains are plugins.** The core engine knows nothing about caches; the
  `cpu-memory` plugin owns causes, generation, simulation, observation, and its
  own independent solver.
- **Generation is constrained, not free-form.** Hidden causes are drawn from a
  cause catalogue; address streams are constructed so real simulation produces
  the claimed symptom class.
- **Validation is adversarial.** A world must survive structural invariants,
  solver-based solvability proof, distractor-refutability checks, non-
  diagnostic rejection, no-lucky-single-probe analysis — and multi-path
  discovery records how many alternative investigations also solve it.
- **Reproducibility is enforced by tests.** Golden worlds must regenerate
  byte-identically or CI fails.

See `docs/MVP_PLAN.md` for what is next, `docs/CPU_MEMORY_DOMAIN.md` for the
causal-family catalogue, `docs/GENERATION_BREADTH.md` for measured diversity,
and `docs/EXISTING_DAU_ARCHITECTURE.md` for how this fits into the ecosystem.

## Verify

```bash
npm ci
npx tsc --noEmit
npm test
node scripts/e2e.mjs   # needs playwright chromium installed
```

CI clones `anil-ganti-nbc/dau-practice-labs` as a sibling checkout and runs the
conformance tests against it, mirroring how every existing Practice Lab repo
consumes the contract.

