# Existing DAU Architecture (as inspected)

*Phase-0 archaeology record. Everything below was verified against repository
contents in August 2026, not taken from prior descriptions.*

## Repositories inspected

| Repo | Role | State |
| --- | --- | --- |
| `idle-time-learning-doodad` | Canonical DAU: curriculum, SRS, quizzes, placement, progression | v1.0 shipped; 27-course content audit merged |
| `dau-practice-labs` | Canonical contract/registry for Practice Labs | skeleton, 2 commits |
| `chudbox` | First external Practice Lab (music/death-metal) | standalone DAU-shaped app |
| `os-lab`, `packet-lab`, `fab-lab`, `compiler-workbench`, `ml-lab`, `pipeline-playground`, `movement-bench` | Ox Alpha-built labs | v1.0.0 + tier-2 hardening commits |
| `semiconductor-intelligence`, clank fleet (`motherclank`, `diagnostic-clank`, …) | adjacent projects, **not part of the practice ecosystem** | out of scope |

## Canonical DAU (`idle-time-learning-doodad`)

**Stack:** Vite + React + TypeScript, TanStack Router, zod everywhere,
PGLite/Postgres *only* for optional auth — never learning state.

**Curriculum representation:** `Category → Course → Module → Concept → Lesson`.
Course manifests are versioned JSON under
`src/content/curriculum/data/<courseId>.json`, validated by
`curriculum/schema.ts` (zod) and assembled at import time. Current census:

- 27 courses across 9 active categories
  (`cpu`, `compilers`, `death-metal`, `horology`, `ml`, `music-theory`,
  `networking`, `os`, `semiconductors`)
- **628 concepts**, tiered 0–5 (21 × T0, 92 × T1, 167 × T2, 197 × T3,
  122 × T4, 29 × T5)
- concept ids are kebab-case with subject prefixes (`cpu-cache-miss`,
  `net-congestion`, `os-race`, `semi-wafer`, …)
- concepts carry `prerequisites: string[]`, `tier`, `estimatedMinutes`
- lessons live per-course under `src/content/lessons/`; lesson ids are
  `{conceptId}-{5|10|20|30}`
- curriculum has its own validation layer (`curriculum/validate.ts`: dangling
  prereqs, duplicate ids, unknown modules/sources) and coverage computation

**Learning state (all browser-local):**

- `dau-progress-v1` (localStorage): profile, per-concept progress, sessions,
  custom catalog, placement
- SRS is SM-2-relative, computed from quiz score + self-rating; ease 1.3–3.2,
  intervals 1–~180d (`lib/learning/srs.ts`)
- export format `dead-air-university-export` schema_version 2
  (`lib/learning/export-schema.ts`) — contains **no practice-evidence fields**
- readiness/evidence machinery (`lib/learning/readiness.ts`,
  `lib/quiz/evidence.ts`) computes demonstrated/waived/frontier concepts from
  quiz ratios and understanding ratings
- quiz generation includes typed distractors
  (`misconception | nearby | reversed | misapplied | subtle`) with rationale
  fields — a ready-made misconception taxonomy any interactive layer can reuse

**Practice-module code in DAU core: none.** No route, lib module, or storage
key references practice results. The contract docs' claim "DAU has no
practice-module code today" is accurate as of commit `bf63b3d`.

## The Practice Labs contract (`dau-practice-labs`)

Small, strict, dependency-light (zod only). Core pieces:

- **Request** (`contract/request.ts`, strictObject): `schemaVersion: 1`,
  `sourceApp` (default `dead-air-university`), `labId`, `conceptId`,
  `lessonId`, `practiceType`, `goal`, plus optional open records
  `initialState`, `parameters`, `constraints`, `completionCriteria` and
  `allowedTools: string[]`. Domain specifics must live inside `parameters`;
  the common schema stays domain-blind.
- **Result** (`contract/result.ts`, strictObject): `schemaVersion`, `labId`,
  `conceptId`, `lessonId`, `completed`, `attempts`, `timeSpentMs`, optional
  `selfRating` 1–5, optional `metadata` map (keys ≤64 chars, primitive values).
- **Transport**: launch via `?practice=<url-safe-base64-json>`;
  return via `postMessage({type:"dau:practice-result", result})` to
  `window.opener`; origin allow-listing on receipt;
  `matchPracticeResult()` rejects wrong lab/concept/lesson.
- **Registry** (`registry/labs.ts`): static rows with `status`
  (`available | implemented-external | planned | disabled`), subject/course
  coverage, `conceptPatterns` globs, capabilities. Resolver helpers:
  `getLab`, `canLaunchLab`, `getCompatibleLabs`.
- **Ownership boundary (documented and enforced by schema shape):** a lab may
  never return mastery scores, SRS intervals, quiz scores, course completion,
  or proficiency judgements.

## Implemented labs (what currently counts as "interactive")

The six Ox Alpha labs share an identical skeleton (`src/lib/practice/{codec,
schema,session}.ts`, `src/content/bank.ts`, `src/modules.ts`, node:test
suites, Playwright e2e script, Dockerfile, CI):

- Five of six (`os-lab`, `fab-lab`, `packet-lab`, `compiler-workbench`,
  `ml-lab`) are **MCQ-deck labs**: sourced question banks, attempt counting,
  self-report completion, plus small animated demos. Interactivity ≈ Level 1–2.
- `pipeline-playground` has a genuine five-stage hazard simulator
  (`sim/model.ts`: forwarding semantics, load-use bubble exactly one cycle,
  branch flush) driving prediction exercises.
- `movement-bench` has a real mechanical movement model + canvas rendering.

Each lab keeps a **local variant** of the contract: `sourceApp: "dau"`, own
result message type (`<lab>:practice-result`), concept-id regexes scoped to
its family, `selfRating` limited to 1–3. Results go both to the visible panel
and `postMessage` to the opener.

## Chudbox (separate lineage, compatible by design)

Full standalone app (React, better-auth, audio engine). Its published contract
(`DAU_INTEGRATION.md`) predates the canonical skeleton and differs in details:
top-level `tempo`/`patternLength` fields, `chudbox:practice-result` message
type, `selfRating` 1–3 with different labels. The canonical repo carries a
dedicated adapter (`adapters/chudbox.ts`) rather than asking Chudbox to
change. Lesson: **compatibility adapters absorb legacy variance; the core
schema does not grow per-lab fields.**

## Audit findings (verified, with evidence)

1. **Contract↔lab drift (confirmed).** Every lab's conformance test imports
   per-lab exports that the current contract skeleton does not publish
   (`OS_LAB_ID`, `adaptOsResultMessage`, `buildOsLaunchUrl`, …).
   Reproduced locally: `npx tsc --noEmit` against a sibling contract checkout
   fails with TS2305/TS2724 in `os-lab/tests/conformance.test.ts`. All seven
   lab repos expect a richer contract revision than the one published at
   `e85070d`. The registry also lacks rows for `os-lab` and `ml-lab`
   entirely, and marks the other five `planned` although implementations
   exist. **Conclusion: the labs were built against a contract state that was
   later reverted/simplified; the ecosystem is mid-audit and the published
   skeleton is behind the implementations.**
2. **Registry status lag.** `canLaunchLab("os-lab")` is false today despite a
   complete deployed implementation.
3. **No audit artefacts.** No branches besides `main` anywhere; no audit
   reports or remediation plans checked into the repos. The "recent broad
   audit" referenced in the brief exists as commit history (the 27-course
   content-defect audit in DAU, tier-2 hardening in labs), not as documents.
4. **Historical artefacts in DAU**: the Grok sandbox `AGENTS.md` (45KB) and
   `.vercel/output` build output remain in-tree. Harmless but worth knowing.

## Implications for the World Generator

- Build against the **canonical contract** as published (schemaVersion 1,
  generic envelope) and treat per-lab local variants as the labs' own affair —
  exactly what the contract's "Adding a future Practice Lab" section prescribes.
- Do **not** assume registry metadata will be updated promptly; carry our own
  manifest and let contract-side registry sync happen when the audit settles.
- Reuse DAU's existing structures wherever possible: concept ids/tiers/
  prerequisites for provenance, the distractor taxonomy for misconception
  targeting, the evidence/readiness patterns as the eventual integration seam
  for practice evidence.
