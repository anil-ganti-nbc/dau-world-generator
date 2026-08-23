# Curriculum Suitability Analysis

*Phase-1 output: which DAU concepts deserve Worlds, which belong in Practice
Labs or inline interactions, and where to start. Based on the 628-concept
manifest census (27 courses, tiers 0–5) inspected in August 2026.*

## Method

A concept is a **strong World candidate** when learning it means learning to
*discriminate between plausible explanations using evidence* — i.e. the
competence is a diagnosis/prediction skill, not recall or procedure. Signals:

1. multiple real phenomena produce similar symptoms;
2. evidence is partial, costly, or ordered (what you check first matters);
3. wrong-but-reasonable models exist and are common;
4. the concept already has quantitative observables (counters, traces, maps).

Concepts that are single-mechanism explanations (e.g. "what is a TLB")
belong in lessons; single-mechanism *practice* belongs in labs/inline.

## Classification by domain

### cpu (77 concepts) — richest World territory
- **Strong World candidates:** `cpu-cache-miss` (conflict vs capacity vs
  coherence vs compulsory discrimination), `cpu-coherency`/`cpu-mesi`
  (false vs true sharing), `cpu-prefetch` (helpful vs harmful),
  `cpu-branch-prediction` family (why IPC dropped), `cpu-ooo-schedule`/
  `cpu-rob` (reorder-buffer pressure diagnosis), `cpu-store-buffer` +
  `cpu-consistency` (memory-model mysteries).
- **Better as Practice Lab:** `cpu-hazards`, `cpu-forwarding`,
  `cpu-cache-levels` mechanics (pipeline-playground already does this well).
- **Inline/prose:** `cpu-virtual-addr`, `cpu-tlb` definitions.

### os (68) — second-strongest
- **Strong World candidates:** `os-deadlock` vs `os-lock` vs `os-sched`
  (freeze triage), `os-page-fault`/`os-swap`/`os-cow` ("is it a leak?"),
  `os-latency-sched` (tail-latency mysteries), `os-journal` (crash-recovery
  forensics), `os-tlb-os` (shootdown storms).
- **Better as Practice Lab:** `os-context-switch` mechanics, `os-fork`/exec
  flows.
- **Inline:** `os-abi`, `os-protection` concepts.

### networking (66)
- **Strong World candidates:** reachability forensics
  (`net-forwarding-vs-routing`, `net-longest-prefix`, `net-icmp`),
  performance forensics (`net-congestion`, `net-bufferbloat`, `net-aimd`,
  `net-head-of-line`), DNS/pathologies (`net-dns-system`), MTU/fragmentation
  blackholes (`net-mtu`, `net-fragment`).
- **Better as Practice Lab:** `net-tcp-state`, handshake/teardown mechanics,
  CIDR drills.
- **Inline:** `net-checksum` walkthroughs.

### compilers (66)
- **Strong World candidates:** miscompilation forensics (UB/aliasing vs
  codegen vs register allocation), compile-time explosions
  (inlining/interprocedural), misoptimization of hot loops (alias + vector
  interaction).
- **Better as Practice Lab:** pass-by-pass IR viewing (compiler-workbench
  territory), parsing/AST drills.
- **Inline:** IR shape demos.

### semiconductors (73)
- **Strong World candidates:** yield excursions (systematic vs random defect
  discrimination), lithography margin failures (focus/exposure/overlay),
  integration comparatives (two fabs, one mask set), electromigration
  failures.
- **Better as Practice Lab:** process-order puzzles, cleanroom-sequence
  drills (fab-lab territory).
- **Inline:** device-physics visualisations.

### horology (70) — surprisingly strong
- **Strong World candidates:** rate troubleshooting (amplitude vs beat error
  vs position-dependent rate), power-curve failures (mainspring vs escapement
  vs train friction), regulation mysteries.
- **Better as Practice Lab:** gear-train ratio drills (movement-bench).
- **Why strong:** watchmaking diagnosis is *the* canonical
  evidence-under-uncertainty craft; symptoms genuinely overlap.

### ml (71)
- **Strong World candidates (later):** training-collapse forensics (LR vs
  init vs data), overfitting-vs-leakage discrimination, inference-latency
  mysteries (batching vs quantisation vs memory-bound).
- **Caution:** ML "evidence" is noisier; worlds here need explicit
  statistical models or they drift into vibes. Defer until the pattern is
  proven on crisper domains.

### music-theory / death-metal (137 combined)
- Chudbox already owns this territory as a construction lab; Worlds add
  little beyond it. Skip for now.

## Prioritised World roadmap

| Priority | Domain | Template | Why now |
| --- | --- | --- | --- |
| 1 | cpu-memory | regression-diagnosis | shipped; richest discrimination structure; exact simulation |
| 2 | cpu-memory | predictive variant | reuses shipped kernels; adds freeze-prediction ritual |
| 3 | os | scheduler-triage | second plugin proves the pattern; strong pilot #9 |
| 4 | networking | reachability-forensics | spatial diagnosis diversifies interaction shape |
| 5 | networking | latency-forensics | bufferbloat pilot #6; pairs with #4 |
| 6 | compilers | pass-bisect | needs IR data model investment first |
| 7 | semiconductors | yield-excursion | needs statistical evidence model |
| 8 | horology | rate-troubleshooting | delightful, but no curriculum pressure; do when the above hold |

## What stays out of Worlds entirely

Concepts whose competence is *production* (write a riff, build a pipeline
schedule) belong in construction labs; concepts whose competence is
*recall/definition* belong in lessons and SRS. Worlds are for the
diagnostic middle where evidence beats explanation.
