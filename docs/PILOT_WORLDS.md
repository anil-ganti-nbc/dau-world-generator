# Pilot World Catalogue

*Twelve concrete pilot worlds across four domains. Depth over breadth: every
entry names the hidden cause, the evidence that discriminates it, and why a
World beats a quiz or simple lab. Diagnostic-first as required.*

Format per entry: **title · domain · concepts (DAU ids) · objective · hidden
cause · opening observations · valid actions · distractors · intended path ·
success criteria · difficulty band · why a World.**

---

## 1. The Loop That Got Slower Overnight *(shipped)*
- **Domain:** cpu-memory (`regression-diagnosis`) · **Concepts:** `cpu-cache-levels`, `cpu-cache-miss`
- **Objective:** diagnose the regression's root cause from counters.
- **Hidden cause:** conflict misses — hot lines remapped onto one set.
- **Opening:** briefing only; regression % + change list.
- **Actions:** perf counters, cache config, miss timeline, line-churn/set distribution, coherence probe, prefetch audit.
- **Distractors:** capacity, false-sharing, prefetch-storm.
- **Path:** perf-counters → set-distribution (skew ≫ 3×).
- **Success:** commit `conflict-miss`. **Band:** 1–3 by distractor handling.
- **Why a World:** the answer is not in any single reading; learners must
  *choose* which counter to buy, and every distractor is a real phenomenon.

## 2. The Cache That Shrank *(designed)*
- **Domain:** cpu-memory · **Concepts:** `cpu-cache-levels`, `cpu-cache-miss`
- **Hidden cause:** working set doubled; sweeps exceed capacity.
- **Distractors:** conflict, false-sharing, prefetch-storm.
- **Discriminator:** spread misses + helpful prefetcher + no churn = capacity;
  requires *combining* two probes to separate from storm.
- **Band:** 3. **Why:** teaches capacity-vs-conflict as distributions, not definitions.

## 3. Ping-Pong *(designed)*
- **Domain:** cpu-memory · **Concepts:** `cpu-coherency`, `cpu-mesi`
- **Hidden cause:** false sharing — two hot counters share one line, cores alternate writes.
- **Discriminator:** cross-core invalidations ≫ local writes on one contended line while miss rate is *low*.
- **Distractors:** true sharing (needs data-flow reasoning to reject: writers touch different words), lock contention.
- **Band:** 3–4. **Why:** the classic "it looks like sharing but which kind?" judgement needs evidence discipline quizzes can't test.

## 4. Help That Hurts *(designed)*
- **Domain:** cpu-memory · **Concepts:** `cpu-prefetch`, `cpu-cache-miss`
- **Hidden cause:** prefetch storm — descending stride defeats next-line prefetch; bus flooded with dead lines.
- **Discriminator:** prefetch audit (useful fraction ~0) *after* distribution shows spread misses — conditional dependency between probes.
- **Band:** 3–4. **Why:** punishes premature conclusions from one probe; rewards sequential hypothesis revision.

## 5. Blackhole Route *(designed)*
- **Domain:** networking · **Concepts:** `net-forwarding-vs-routing`, `net-longest-prefix`, `net-icmp`
- **Situation:** one destination subnet intermittently unreachable after a router config push.
- **Hidden cause:** overlapping prefix with wrong next-hop wins longest-prefix match.
- **Actions:** traceroute variants, route-table dumps per hop, ping w/ DF, capture ICMP unreachable types.
- **Distractors:** MTU blackhole, ACL drop, link flap, ARP staleness.
- **Path:** traceroute (where path dies) → route dump at dying hop (which prefix) → compare with control destination.
- **Success:** name the offending prefix + router. **Band:** 2–3.
- **Why:** diagnosis is *spatial* (walk the path) and *comparative* (works for other prefixes) — neither fits MCQ shape.

## 6. The Great Slowdown *(designed)*
- **Domain:** networking · **Concepts:** `net-congestion`, `net-bufferbloat`, `net-aimd`
- **Hidden cause:** bufferbloat — oversized bottleneck buffers inflate queue delay; throughput fine, latency terrible.
- **Actions:** throughput probes, RTT under load vs idle, queue occupancy snapshots, window traces.
- **Distractors:** bandwidth saturation, lossy link, receiver-window limits, DNS latency.
- **Discriminator:** throughput near link rate + RTT inflation concentrated at bottleneck + zero retransmits.
- **Band:** 3. **Why:** forces separating throughput health from latency health — a mental model, not recall.

## 7. The Case of the Wrong Answer *(designed)*
- **Domain:** compilers · **Concepts:** `cmp-*` optimisation/IR family
- **Situation:** `-O2` build of an expression evaluator returns wrong results for some inputs; `-O0` is correct.
- **Hidden cause:** UB — signed overflow assumption lets a pass reorder/canonicalise an expression.
- **Actions:** IR diff viewer per pass (bisect passes), constant-fold trace, alias analysis dump, input fuzz harness.
- **Distractors:** miscompile in codegen, register allocation bug, strict-alias violation, undefined float ordering.
- **Path:** bisect passes → inspect transformation of the offending expression → identify invalidated assumption.
- **Band:** 4. **Why:** "which assumption was invalid" is precisely causal reasoning about a system's rules.

## 8. Compile Time Explosion *(designed)*
- **Domain:** compilers · **Concepts:** inlining/interprocedural family
- **Hidden cause:** a tiny header change turns one function into an inlining magnet; pass runs go quadratic.
- **Actions:** per-phase timing, call-graph size metrics, pass iteration counts, IR unit counts.
- **Distractors:** template instantiation blowup, LTO memory pressure, diagnostic emission loop.
- **Band:** 3. **Why:** performance archaeology with structural evidence; mirrors real build-bug triage.

## 9. Thursday Afternoon Freeze *(designed)*
- **Domain:** OS · **Concepts:** `os-lock`, `os-deadlock`, `os-sched`, `os-preempt`
- **Hidden cause:** priority inversion — low-prio holder preempted by medium-prio spinners; high-prio waiter starves.
- **Actions:** per-process states, lock ownership graph, priority table, scheduler trace, futex stats.
- **Distractors:** deadlock cycle (graph must show none), CPU saturation (idle exists), thrashing (no paging storm).
- **Path:** find blocked high-prio → owner state → who's running instead → inversion conclusion.
- **Band:** 4. **Why:** multi-hop causal chain through scheduler semantics; each probe eliminates one classic suspect.

## 10. Memory Leaks Are Not Always Leaks *(designed)*
- **Domain:** OS · **Concepts:** `os-page-fault`, `os-swap`, `os-page-cache`, `os-cow`
- **Hidden cause:** copy-on-write storm after fork bomb pattern; RSS growth is shared pages faulting privately, not a leak.
- **Actions:** /proc-style per-process maps, fault counters (major/minor), swap trend, page-cache size, fork history.
- **Distractors:** genuine leak, cache bloat, mmap of huge file, fragmentation.
- **Band:** 3–4. **Why:** the "obvious" diagnosis (leak) is wrong for a subtle reason; wrong models become observable exactly as the vision demands.

## 11. The Yield Cliff *(designed)*
- **Domain:** semiconductors · **Concepts:** `semi-process`, `semi-litho` families
- **Situation:** yield drops 12% after moving a layer to a different tool.
- **Hidden cause:** focus/exposure margin mismatch — overlay offsets interact with post-etch bias on dense patterns only.
- **Actions:** wafer maps by pattern density, overlay metrology distributions, CD-SEM trends, split-lot comparisons.
- **Distractors:** particle excursion (random defect signature ≠ systematic pattern-correlated), chamber aging, photoresist batch.
- **Discriminator:** defect spatial/pattern correlation distinguishes systematic from random.
- **Band:** 4. **Why:** fab decisions cost millions; reasoning from statistical evidence under multiple plausible culprits is the actual job.

## 12. Two Fabs, One Mask Set *(designed)*
- **Domain:** semiconductors (comparative mode) · **Concepts:** process-integration family
- **Situation:** identical design runs at two sites; site B has worse electromigration lifetime.
- **Hidden cause:** different metal fill density rules applied during prep.
- **Actions:** side-by-side rule decks (diff view), failure site microscopy, current-density maps, temperature ramp data.
- **Distractors:** copper purity, CMP dishing, package thermal difference.
- **Band:** 4. **Why:** comparative worlds teach *which parameter differences matter*, the hardest part of technology transfer.

---

## Coverage summary

| Domain | Pilots | Modes |
| --- | --- | --- |
| cpu-memory | 1–4 (1 shipped) | diagnostic ×4 |
| networking | 5–6 | diagnostic ×2 |
| compilers | 7–8 | diagnostic, forensic-performance |
| OS | 9–10 | diagnostic ×2 |
| semiconductors | 11–12 | diagnostic, comparative |

Sequencing recommendation: 2→4→3 within cpu-memory (extend the shipped
template before new templates), then 6 (networking, single-host first),
then 9 (OS). Compilers and semiconductors pilots need richer domain models
(IR structures, wafer statistics) and come after the plugin pattern has been
repeated once outside its birthplace.
