# Audit Findings & Coordination Notes

*Standing record of the ecosystem audit state as it affects this repo.
Read before touching dau-practice-labs or any lab repository.*

## Finding 1: contract↔lab drift (open, upstream)

**Evidence (reproduced locally, Aug 2026):** every Ox Alpha lab's
conformance suite imports per-lab exports from `dau-practice-labs` that the
current contract skeleton does not publish:

```
tests/conformance.test.ts(5,3): error TS2305: no exported member 'OS_LAB_ID'
tests/conformance.test.ts(8,3): TS2724: no exported member named 'adaptOsResultMessage'
tests/conformance.test.ts(9,3): TS2305: no exported member 'buildOsLaunchUrl'
```

All seven lab repos share this pattern (`FAB_LAB_ID`, `PACKET_LAB_ID`,
`ML_LAB_ID`, …). The published contract (`e85070d`, 2 commits) has only the
Chudbox adapter and marks five labs `planned` despite shipped
implementations; `os-lab` and `ml-lab` have no registry rows at all.

**Conclusion:** labs were built against a richer contract revision that was
later reverted or never pushed; the ecosystem is mid-audit.

**This repo's position:** build against the *published* canonical schema
only. We add zero fields to the core request/result schemas; our world
coordinates ride in `parameters`, our outcomes in result `metadata`. When
the upstream audit settles and per-lab adapters land, adding a
`world-generator` adapter row is a small follow-up — nothing here blocks it.

## Finding 2: no in-repo audit artefacts

No non-main branches exist on any inspected repo; no audit reports or
remediation plans are checked in. The "recent broad audit" exists as commit
history (DAU's 27-course content-defect audit merged via PRs #2–#4;
tier-2 hardening commits across labs). Treat commit archaeology, not docs,
as the audit record.

## Finding 3: historical artefacts in DAU

The Grok sandbox `AGENTS.md` (45KB) and a committed `.vercel/output` build
remain in the DAU tree. Harmless to this project; noted so nobody mistakes
them for current architecture guidance.

## Coordination rules adopted by this repo

1. **Observe-only toward DAU and lab repos** until upstream architecture
   stabilises. No PRs into them without explicit instruction.
2. **Canonical schema only.** If a needed handshake feature is missing,
   document the gap (here and in coordination with the contract owner)
   rather than growing this skeleton unilaterally.
3. **Concept ids come from canonical manifests**, verified against catalog
   snapshots; discrepancies are reported upstream, not forked locally.
4. **Registry sync is upstream's call.** Our domain manifests live in
   `fixtures/` and describe possibility space; they do not pretend to be
   contract-registry rows.

## Upstream items we would like (not blocking)

- Contract registry row for `world-generator` when status is agreed.
- Per-lab adapter exports restored or superseded by an agreed pattern
  (resolves Finding 1 for everyone).
- A decision on whether practice evidence enters export-schema v3.
