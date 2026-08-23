# World Generator Vision

*What a DAU World is, why it exists, and what it must never become.*

## The idea in one sentence

Instead of asking the learner a question, give them a system with hidden
causes, observable evidence, available actions, and consequences — then
require them to work out what is happening.

## Where it sits in DAU's interactivity ladder

| Level | Form | Duration | Examples |
| --- | --- | --- | --- |
| 1 | Inline interactive lesson | ~2–10 min | slider, predict-then-reveal, small state machine |
| 2 | Practice Lab | ~10–30+ min | `os-lab`, `packet-lab`, `fab-lab`, `pipeline-playground`, Chudbox |
| 3 | **World** | ~10–60+ min | generated diagnostic/predictive scenario requiring investigation |

A lesson says *here is how cache conflict misses work*. A Practice Lab says
*predict whether these accesses hit or miss*. A World says *this program got
35% slower after an unrelated-looking change — here is the machine, find out
why.*

The levels differ in kind, not just length: Level 1 manipulates one concept,
Level 2 drills one concept family, Level 3 forces the learner to *manage
uncertainty across a whole system* — forming hypotheses, choosing which
evidence to buy, revising models when evidence contradicts them.

## The non-negotiables

1. **Causality.** A world is `hidden state → rules → evidence`. If the world
   says conflict misses caused a slowdown, a real cache simulation must have
   actually evicted hot lines to produce those counters. An LLM may assist
   around a world; it may never be its physics engine.
2. **Reproducibility.** `(domainId, templateId, seed)` regenerates the world
   byte-for-byte. Enforced by golden-fixture tests.
3. **Solvability before exposure.** The engine refuses to hand over a world
   that an independent solver cannot solve from learner-visible evidence.
4. **DAU owns learning state.** Worlds return lightweight practice evidence
   through the Practice Labs contract; mastery/SRS/placement stay in DAU.
5. **Difficulty is structure, not prose.** Difficulty comes from more
   hypotheses, subtler symptoms, costlier probes, interacting causes — never
   from confusing writing or random noise.

## Modes (long-term)

- **Diagnostic** (v1): something is wrong; find the root cause.
- Predictive: freeze a prediction about a proposed change before running it.
- Optimisation: improve a system under constraints.
- Construction: build/configure to meet a target.
- Comparative: two systems diverge; explain why.
- Failure-injection: the learner introduces faults and observes consequences.
- Multi-domain: cross-track worlds (storage workload → scheduler → network
  latency). Strictly after single-domain worlds are trustworthy.

## LLM role boundary

Good uses (later): narrative phrasing of briefings, hint generation against
known misconception points, variant wording, post-mortem coaching on the
learner's failed hypothesis.

Bad uses: inventing behaviour, grading answers without structured evidence,
altering world rules mid-session, being a source of curriculum truth.

The world itself is the teaching object. AI assists around it or not at all.

## What success looks like

A learner who finishes a cpu-memory world can *transfer*: given a real perf
trace on a real machine, they reach for miss-rate timelines and set
distributions unprompted, form hypotheses before reading counters, and treat
a wrong hypothesis as information rather than failure. Repeated seeds should
feel like new cases of the same underlying skill, not the same puzzle reskinned.
