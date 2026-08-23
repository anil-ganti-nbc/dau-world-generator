# Runtime Architecture

*How a world executes: options considered, the model chosen, and why.*

## Options considered

| Model | Fit for worlds |
| --- | --- |
| Pure deterministic state machine | Perfect reproducibility; awkward for continuous quantities (miss rates, latency curves) |
| Event-driven simulation | Rich but heavy; event ordering complexity invites non-determinism |
| Discrete-step simulation | Natural for cycles/packets/time-slots; risk of step-count explosion in UI contexts |
| Domain plugin engines | Necessary for multi-domain, but a free-for-all without a common contract |
| **Hybrid (chosen)** | Deterministic core + per-domain simulation kernels behind one observation contract |

## Chosen model

```
WorldEngine (core, domain-blind)
  register(plugin)            one DomainPlugin per domain
  generate(options)           seed → plugin.generate() → validation → WorldSpec
  observe(spec, actionId)     delegates to plugin.observe(hidden, actionId)
  isCorrect(spec, hyp)        engine-side truth check
  explain(spec)               canonical explanation from ground truth
Session (UI-owned)
  spec + accumulated observations + frozen hypothesis + commit
DomainPlugin (per domain)
  causes(), generate(), observe(), solve(), explain()
  + private simulation kernels (sim.ts) that produce all evidence
```

### Execution properties

- **Inspect:** `observe()` runs the learner's chosen probe against hidden
  state. v1 probes are pure functions — repeated inspection yields identical
  readings. The UI makes re-reads free and replaces rather than duplicates.
- **Advance time / change configuration:** deferred to v2 by design. The
  `actionCount` parameter of `observe()` already carries the session clock so
  plugins can later make observations path-dependent without schema change.
- **Generate observations:** always through simulation kernels (`sim.ts`).
  The plugin never stores authored evidence text keyed by cause; it computes
  it. This is what makes worlds causal rather than narrated.
- **Evaluate consequences:** `engine.isCorrect()` compares the committed
  hypothesis id with `solution.correctHypothesisId`. Grading never consults
  prose or an LLM.
- **Replay:** a session is fully described by `(spec seed coordinates,
  sequence of action ids, frozen hypothesis ids)`. Because observations are
  deterministic functions of hidden state, replaying the action list
  reproduces the session exactly.
- **Reproduce:** `generate()` from the same `(domainId, templateId, seed)`
  returns byte-identical specs (mulberry32 PRNG forked per purpose;
  FNV-1a string hashing; fixed timestamp). Enforced by golden-fixture tests.

## Why not a full discrete-step simulator in the core?

The core would then need to know what a "cycle" or "packet" means. Instead:

1. Each domain builds its own address streams / packet sequences / process
   traces at generation time and *pre-simulates* them into hidden parameters.
2. Probes re-run cheap pure kernels over those streams on demand.

This keeps generation O(stream construction), makes every probe a pure
function, and confines time to each domain's own semantics. Domains that
genuinely need stepping (e.g. an interactive scheduler world where the learner
changes priorities mid-run) can expose `configure` actions whose results are
new pre-computed variants selected deterministically — the core contract does
not change.

## Trade-offs accepted

- Pre-simulation bounds world variety to what streams can express (fine:
  possibility space should be constrained anyway).
- Stateless v1 probes cannot model learner-triggered dynamics (deferred
  deliberately — diagnosis first, manipulation later).
- Two implementations of truth exist per domain (generator + solver); they
  must share the kernel layer or drift. Validation exists precisely to catch
  that drift, and golden fixtures pin it.
