# Tech debt review — 10 October 2026

A prioritized, evidence-based pass over what merged from **18 September 2026** through **10 October 2026**. This is a review, not a refactor. Nothing in this file is a code change.

**For Jake.** You merge everything. The useful output is the [top 10](#top-10-by-impact) and the one-PR follow-ups. In-progress issues (FIX-1816, FIX-1796, FIX-1802, FIX-1792) are listed as remaining surface, not as forgotten work.

## How to read this

Each finding has: **severity**, **why it matters**, **evidence** (paths + PR / issue numbers), **suggested follow-up** (one PR-sized item).

Severity:

- **High** — security, a half-shipped public path, or a public-API rename that will keep leaking into every later PR
- **Medium** — duplicated mechanisms, layer leaks, CI fragility, or docs that will teach the wrong model
- **Low** — hygiene, nits, already-owned backlog

Claims that I could not confirm are marked **unconfirmed**, not guessed.

## Scope and method

| | |
|---|---|
| Window | 2026-09-18 → 2026-10-10 |
| Merged GitHub PRs in window | **577** (`git log --merges` matching `Merge pull request #`) |
| Review HEAD | `origin/main` at `3ba717798` (includes [#3005](https://github.com/fixpoint-labs/flow-state-dev/pull/3005)). Local checkout started 31 commits behind; security items were re-checked on `origin/main`. |
| Focus | FIX-1786 rename/refactor epic; FIX-1791 / 1794 / 1802 / 1816 task and hand-off work; Workforce / shift-manager; memory; engine routes; mailbox / coordinator |
| Method | `git log`, GitHub merged-PR search, Linear issue status, targeted reads of the cited files. Review threads: 30 prioritized merged PRs (not all 577). `graft` was not installed in this environment. |
| Linear at review time | FIX-1786 Spec Approved · FIX-1791 Done · FIX-1794 Done · FIX-1796 Spec Approved (implementation not started) · FIX-1802 In Development · FIX-1816 In Development · FIX-1568 Done · FIX-1792 In Development |

No changeset. Internal report only. Do not merge this PR.

---

## Top 10 by impact

1. **`GET /sessions/:id` still reloads the session without the checked record** — leftover from [#2952](https://github.com/fixpoint-labs/flow-state-dev/pull/2952) / FIX-1616. Same incarnation race the other session routes just closed.
2. **`resolveTemplateRaw` still reads unfiltered persisted maps** — leftover from [#3005](https://github.com/fixpoint-labs/flow-state-dev/pull/3005) / FIX-1568. `/state` is fenced; the template reader is not.
3. **Finish FIX-1816 P3: wire `addTaskAndWait` + `resumeOwedAsks`, and lift `task-notice` into orchestration.** Half-shipped: rows can get `resumeOwed: true` with no production waker.
4. **Finish FIX-1796 (do not start a second rename).** Public API, discovery domain, React panels, and Shift Manager still say `seat` / `mailbox` / `room`. Census at review: 17,657 unswept lines / 521 files.
5. **Split the two engine files every recent merge touches** — `createExecutionContext.ts` (4,128 lines) and `runAction.ts` (2,941 lines; `runActionAttempt` ~1,900). Plus the execution ↔ context ↔ host import cycle.
6. **File the orphan security follow-ups from [#2952](https://github.com/fixpoint-labs/flow-state-dev/pull/2952) and [#3005](https://github.com/fixpoint-labs/flow-state-dev/pull/3005)** before they age out of review threads. You already named them as follow-up issues; they have no Linear ids.
7. **`@flow-state-dev/fsdev` hard-depends on Workforce** for `fsdev gen`. Layer-1 CLI installs Layer 2 for every consumer.
8. **One family for collection page-readers and convention-file loaders.** Four `parse*Md` copies and three `MAX_PAGES = 1000` / page-size-200 loops already disagree in small ways.
9. **Pin or mirror `redis:7` in CI.** Unpinned Docker Hub pull on `test` and `packed-install`. Recent rate-limit failures: **unconfirmed** from this environment (no Actions-log pull).
10. **D9 leftovers that still dual-read or alias** — `createSkillsCapability`, `agents?`/`catalog?` typed shims, `awaiting_review` → `parked`, hand-off dispatch field still named `seat`. D9 says drop them; they are still in the tree.

---

## 1. Duplicated or diverging mechanisms

### 1.1 One ending detector, several interpreters of “what the ending meant”

| | |
|---|---|
| **Severity** | Medium |
| **Why it matters** | The lead’s “two task-ending detectors” suspicion is half right. Ledger detection is one function. Ask resume, UI `TaskChangeKind`, and advisory write-back each map terminal status again and do not call `endingOf`. A fix to completion semantics in one place will not reach the others. |
| **Evidence** | Canonical detector: `endingOf` in `packages/orchestration/src/tasks/collection/ending.ts` (comment: “The one place an ending is detected”; `internal.ts` calls it per write). **Not a second detector:** `packages/workforce/src/conversation-board/task-notice.ts` `recordEnding(row, ending)` stamps `noticeOwed:*` metadata from an already-computed `TaskEnding`. Parallel maps: `outcomeOf` in `packages/orchestration/src/tasks/helpers/wait-for-response.ts`; `complete()` passing `"completed"` as both status and `TaskChangeKind` in `packages/orchestration/src/tasks/collection/resource-backed.ts`; `resolveTarget` in advisory write-back. Shipped with FIX-1794 P2 ([#2935](https://github.com/fixpoint-labs/flow-state-dev/pull/2935)) and FIX-1816 ([#2920](https://github.com/fixpoint-labs/flow-state-dev/pull/2920), [#2922](https://github.com/fixpoint-labs/flow-state-dev/pull/2922), [#2964](https://github.com/fixpoint-labs/flow-state-dev/pull/2964)). |
| **Follow-up** | Small helper PR: derive ask outcome and emitted `TaskChangeKind` from `TaskEnding` / `endingOf`. Add a test that fails if `outcomeOf` and `endingOf` disagree on cancelled vs errored. |

### 1.2 Child-finished signal still lives in Workforce, pending the FIX-1816 lift

| | |
|---|---|
| **Severity** | High (owned by FIX-1816; still a layer leak until it moves) |
| **Why it matters** | The module is orchestration-shaped (pure functions, orchestration types, a test that forbids workforce imports) but ships under `packages/workforce`. Every later consumer will copy it or import the wrong layer. |
| **Evidence** | `packages/workforce/src/conversation-board/task-notice.ts` header: “FIX-1816 lifts this module into `orchestration` as it stands.” Wired from `ledger.ts`. Tests: `packages/workforce/test/task-notice.test.ts`. Spec: FIX-1815 Q2 / FIX-1816 L4. Linear: FIX-1816 **In Development**. |
| **Follow-up** | The already-planned FIX-1816 lift PR. Move the module + tests; repoint S6/S7 imports; keep the layer-clean test against orchestration only. |

### 1.3 Ask is implemented, not wired (`addTaskAndWait` / `resumeOwedAsks` are test-only)

| | |
|---|---|
| **Severity** | High |
| **Why it matters** | `recordResumeOwed` already writes `resumeOwed: true` on board rows. The waker that clears and resumes is imported only from tests. Production cannot complete an ask end-to-end. Rows can accumulate owed markers with nothing to wake them. |
| **Evidence** | `packages/orchestration/src/tasks/helpers/wait-for-response.ts` lines 23–24: “Package-internal until FIX-1816 P3 wires it into `addTask` and the child-finished notice; nothing re-exports it yet.” Repo grep: `resumeOwedAsks` / `addTaskAndWait` appear in that file and in `packages/orchestration/test/tasks/{ask-fixture,wait-for-response}.test.ts` only. Not on `createTaskToolsCapability`. PRs: [#2912](https://github.com/fixpoint-labs/flow-state-dev/pull/2912), [#2920](https://github.com/fixpoint-labs/flow-state-dev/pull/2920), [#2922](https://github.com/fixpoint-labs/flow-state-dev/pull/2922), [#2964](https://github.com/fixpoint-labs/flow-state-dev/pull/2964). |
| **Follow-up** | FIX-1816 P3 (already scoped): export/call `resumeOwedAsks` from the single board-touch site; add `waitForResponse` on task tools; one integration scenario that does not call the waker from the fixture. |

### 1.4 Collection page-readers copied three ways

| | |
|---|---|
| **Severity** | Medium |
| **Why it matters** | Same safety rules (page size 200, cap 1,000, cursor/offset loop, “stop rather than show a partial list as complete”) are reimplemented. A stuck-cursor fix in React will not reach DevTool or Shift Manager. |
| **Evidence** | `packages/react/src/components/panels/reads.ts` (`MAX_PAGES = 1000`). `packages/devtool/src/react/lib/inventory.ts` comments that it mirrors React; `readEveryPage`. `packages/shift-manager/src/lib/reads.ts` (`PAGE_SIZE = 200`, `MAX_PAGES = 1000`). Workforce mailbox history scan uses offset paging at 200 (`packages/workforce/src/mailbox/pre-rename.ts`). |
| **Follow-up** | One helper on `@flow-state-dev/client` (or core): `readAllCollectionPages(...)`. Migrate the three readers. Leave the request-history offset loop as an optional adapter. |

### 1.5 Four convention-file `parse*Md` copies

| | |
|---|---|
| **Severity** | Medium |
| **Why it matters** | Shared `splitFrontmatter` / `parseFrontmatterYaml` already exist in orchestration. Required-`description` validation and error strings are copy-pasted per file type. Historical drift already happened (resources got a root-containment check before workforce/skills — `packages/workforce/test/symlink-containment-matrix.test.ts`). |
| **Evidence** | Same shape in `read-workforce-directory.ts` `parseWorkerMd`, `read-teams-directory.ts` `parseTeamMd`, `read-resources-directory.ts` `parseResourceMd`, `read-mailboxes-directory.ts` `parseMailboxMd`. Intentional exception: worker files also run `refusedDeclaration` / `workerConfigSchema()`. |
| **Follow-up** | `parseConventionMd(text, { fileLabel, requiredKeys, refusedKeys })` next to the shared frontmatter helpers. Four loaders become thin wrappers. Keep the worker-schema exception. |

### 1.6 Two full task-collection backings

| | |
|---|---|
| **Severity** | Medium |
| **Why it matters** | `internal.ts` exists specifically because the two backings drift. Claim / complete / fail / emit still fork in both files. |
| **Evidence** | `packages/orchestration/src/tasks/collection/internal.ts` header: “keeps the two backings in lockstep.” Parallel transition paths in `state-backed.ts` and `resource-backed.ts`. |
| **Follow-up** | Do not merge the backings in one PR. Extract a transition executor (emit + `applyTransition` + decline reasons). Leave CAS vs resource update as the only fork. |

### 1.7 Several filing and hand-off paths (overlapping surfaces)

| | |
|---|---|
| **Severity** | Medium (product surface), Low (if treated as distinct APIs) |
| **Why it matters** | Tasks enter boards via conversation `addTask`, orchestration task tools, mailbox `fileTaskFor`, and coordinator `handOffTool` (posts, not tasks). Assignee checks and wake/replay can diverge. The word `handOff` means three different dispatches. |
| **Evidence** | Conversation board: `packages/workforce/src/conversation-board/board.ts`. Tools: `packages/orchestration/src/skills/task-tools-capability.ts` (`checkAssignee`, FIX-1794 T1). Mailbox: `packages/workforce/src/mailbox/mailbox-flow.ts` `fileTaskFor`. Coordinator post hand-off: `packages/workforce/src/coordinator/coordinator-flow.ts`. Task-board hand-off: `packages/orchestration/src/task-board/blocks/hand-off.ts`. PRs: [#2935](https://github.com/fixpoint-labs/flow-state-dev/pull/2935), [#2985](https://github.com/fixpoint-labs/flow-state-dev/pull/2985), [#2865](https://github.com/fixpoint-labs/flow-state-dev/pull/2865), [#3003](https://github.com/fixpoint-labs/flow-state-dev/pull/3003) (FIX-1802 P1, on `origin/main`). |
| **Follow-up** | One internal `fileTaskRow(...)` used by the conversation resolver and mailbox `fileTaskFor`. Rename internal block names (`taskHandOff` / `mailboxPostDispatch` / `coordinatorDelegateHandOff`) in a separate no-behavior PR. |

**Confirmed not duplicates:** `readSeatSkills` composes `readSkillsDirectory`. Notice send is unified in `sendOwedNotices`. Memory’s capability vs system builder is layering, not a second loader. Harness-manager settlement uses orchestration task APIs and does not reimplement `endingOf`.

---

## 2. Layering leaks

Runtime import graph for orchestration / engine / core / memory / harness-manager / patterns: **clean**. No `@flow-state-dev/workforce` imports in those `src/` trees. Mailbox and coordinator **implementations** sit in Workforce, which is correct.

### 2.1 `fsdev` hard-depends on Workforce

| | |
|---|---|
| **Severity** | High |
| **Why it matters** | Every `@flow-state-dev/fsdev` install pulls Workforce, even for `run` / `serve` / `dev`. The Layer-1 CLI is coupled at the package boundary, not just at command registration. |
| **Evidence** | `packages/cli/package.json` dependency `"@flow-state-dev/workforce": "workspace:*"`. Sole production import: `packages/cli/src/commands/gen.ts` (`@flow-state-dev/workforce/codegen` + `/loader`). The app-hook layer test (`packages/cli/test/layer-boundary.test.ts`) correctly forbids workforce imports in `dev.ts` / `node` serve — and **does not include `gen.ts`**. That exception is the leak. |
| **Follow-up** | Move `fsdev gen` onto a Workforce CLI plugin, or make workforce an optional peer and dynamic-import inside `executeGenCommand` with a clear error if missing. |

### 2.2 Orchestration’s public frontmatter API is shaped by `WORKER.md`

| | |
|---|---|
| **Severity** | Medium |
| **Why it matters** | Dependency direction is fine (workforce imports orchestration). The **public** orchestration export is documented as serving `SKILL.md` **and** `WORKER.md`. Layer 1’s API is being designed around a Layer 2 file. |
| **Evidence** | `packages/orchestration/src/index.ts` and `packages/orchestration/src/shared/frontmatter.ts`. Workforce loaders import `splitFrontmatter` / `parseFrontmatterYaml`. |
| **Follow-up** | Extract shared frontmatter to contracts (or a tiny convention-md module). Orchestration documents skills only. Workforce imports the shared module. Same PR as 1.5 if you want one loader family. |

### 2.3 Discovery domains pin Workforce nouns in contracts + core

| | |
|---|---|
| **Severity** | Medium — owned by FIX-1796 D7 / S2 |
| **Why it matters** | Zero-dep contracts and core’s `discover` tool teach `"seats"` and `"mailboxes"` to every app, including ones that never hire a workforce. |
| **Evidence** | `packages/contracts/src/types/manifest.ts`: `MANIFEST_DOMAINS = ["seats", "mailboxes", "skills", "resources"]`. `packages/core/src/manifest/discovery-tools.ts` tool copy. FIX-1786 D7: rename to `workers`; FIX-1792 removes `mailboxes`. |
| **Follow-up** | Do this inside FIX-1796 P1 S2, not as a third rename. |

### 2.4 Comments in Layer 1 name Workforce as a special caller

| | |
|---|---|
| **Severity** | Low–Medium |
| **Why it matters** | No runtime import, but behavior is documented as tuned for one L2 package (`enableKeywordMatch: false`, mailbox `taskToolActions` examples, harness-manager `<mailbox>.<board>` id grammar). |
| **Evidence** | `packages/orchestration/src/skills/skill-activator.ts`, `initial-skills.ts`, `task-tools-capability.ts`. `packages/harness-manager/src/identity.ts`. `packages/engine/src/context/session-birth.ts` (mailbox session-create comment). Engine already has `packages/engine/test/workforce-coupling-guard.test.ts`. Orchestration has a policy comment and **no** equivalent guard. |
| **Follow-up** | Add `orchestration/test/workforce-coupling-guard.test.ts` mirroring engine. Neutralize comments in the same PR or the next touch. |

---

## 3. Vocabulary drift (FIX-1796 owns the sweep)

FIX-1796 is **Spec Approved**, implementation not started. Do **not** open a competing rename. This section is the remaining inventory.

Term census (`node specs/issues/FIX-1796/poc/term-census/check.mjs`) at review: **FAIL — 17,657 unswept lines in 521 files.** Top tokens: `seat` 6,590 / 364 files; `mailbox` 5,101; `kind` 2,643 on Workforce ground; `room` 888; `person` 658; `talk-session` 301.

### 3.1 Public API still on `seat*` (FIX-1796 P1)

| Surface | Still says | Target |
|---------|------------|--------|
| `packages/orchestration/src/task-board/hand-off.ts` | `TaskSeat`, `TaskSeatRegistry`, `HandOffSeat` | `TaskAssignee*` |
| `packages/core/src/types/dispatch.ts` | field `seat` (comment already says “assignee”) | `assignee` |
| `packages/contracts` / discovery | domain `"seats"` | `"workers"` |
| `packages/workforce/src/index.ts` | `mergeSeatFlows`, `seatDoorOf`, `SEAT_DISCOVER_KEY`, `seatSkillSchema`, … | `worker*` |
| `packages/workforce/src/worker-config.ts` | `seatId`, `seatTools`, `seatSkills`, `seatPackages` | `worker*` |
| `packages/workforce/src/inventory/collections.ts` | pattern `inventory/seats/*` | `inventory/workers/*` |
| `packages/react/src/index.ts` | `RosterSeat`, `SeatDetail`, `isSeat` | worker vocabulary |
| `packages/shift-manager/src/lib/reads.ts` | `Ask.seatId` while comments already say `workerId` | `workerId` |
| Shift Manager UI | fallback “unknown seat”; `Room` / `data-talk-session` | worker / project coordinator |

`CLAUDE.md` package map and `packages/workforce/package.json` description still say “Seat factory”. FIX-1796 PLAN already names that line.

### 3.2 Docs disagree with themselves

| Docs say | Code / other docs say | Where |
|----------|------------------------|--------|
| Glossary: **Assignee** | Task-board pages and types still **seat** | `apps/docs/docs/glossary.md` vs `task-board.md` vs orchestration |
| Configuration: registry key **`workers`** | Types still `TaskSeatRegistry`, field `seat` | `apps/docs/docs/orchestration/configuration.md` |
| Workforce README: task **`assignee`** | Config still `seatId`; inventory `inventory/seats/*` | `packages/workforce/README.md` vs `worker-config.ts` |

### 3.3 Outside FIX-1796 — do not redo

- **`goals/`** words stay (BR-9); identifiers follow exports.
- **`specs/`** retained history stays (BR-8).
- Engine `kind` / owner pins are FIX-1798.
- **`role`**: no production Workforce `Role` type found. Hits are LLM `role: "user"|"assistant"`, ARIA, and process “roles” in `AGENTS.md`.
- `seat-hire-blocks.ts` and `channel-flow.ts` are **gone** at HEAD (removed FIX-1788 / renamed to `mailbox-flow.ts`). Successor is `packages/workforce/src/workers/hire-blocks.ts`.

**Follow-up:** Finish FIX-1796 P1 (code + package docs) then P2 (site + CI guard). One issue, not a new one.

---

## 4. Dead code, shims, flags, TODOs

D9 (FIX-1786, [#2841](https://github.com/fixpoint-labs/flow-state-dev/pull/2841)): no migration, dual-read, alias, upgrade page, or refusal-by-name while there are no consumers. BP-030 loses to D9 for this epic. Compat shims are debt.

### 4.1 `createSkillsCapability` — exported, unused in production

| | |
|---|---|
| **Severity** | Medium |
| **Why it matters** | Two skills entry points. Docs say prefer `createSkillsLibrary`. Callers of the legacy export get a quieter, smaller object with no signal. |
| **Evidence** | `packages/orchestration/src/skills/capability.ts` header cites FIX-1390. Production path: `createSkillsLibrary` in `packages/workforce/src/agent-worker-flow.ts`. No use in `apps/`, `examples/`, `packages/patterns`, or `packages/workforce` (other than the library). |
| **Follow-up** | FIX-1390: `@deprecated` + changeset, or hard-remove per D9 if there is no published consumer. |

### 4.2 Typed shims for removed Workforce options

| | |
|---|---|
| **Severity** | Medium |
| **Why it matters** | Compile-time aliases for `agents` / `catalog`. D9 forbids aliases. |
| **Evidence** | `packages/workforce/src/workforce-capability.ts` `agents?` and `catalog?` with `@deprecated` string-literal types. Body reads `roster` / `inventory` only. |
| **Follow-up** | Delete the keys. Excess-property errors are enough. |

### 4.3 Other shims still in tree

| Item | Severity | Status | Follow-up |
|------|----------|--------|-----------|
| `LEGACY_PARKED_STATUS = "awaiting_review"` → `"parked"` | Low–Medium | Confirmed in `packages/orchestration/src/tasks/schema/task-status.ts` + migration tests | Drop dual-read if no external stores hold the old status; else document as the BP-030 exception D9 did not cover |
| Hand-off dispatch field still `seat` | Low | `packages/orchestration/src/task-board/blocks/hand-off.ts` sets `seat: assignee` | FIX-1796 S1; no dual-read |
| Engine `PrincipalResolver` alias | Low | Confirmed used | Optional deprecate; not D9-scoped (engine, not Workforce epic) |
| Engine `resources/` re-export shims | Low | Confirmed used inside engine | Point imports at core; delete shims (BP-034) |
| `TODO(FIX-511)` cross-process live tail | Low | `packages/engine/src/stores/types.ts` | Implement or close FIX-511 |

**No stale `FEATURE_*` / `ENABLE_*` flags** found in the hot packages’ `src/`. Lab env vars (`DEVTEAM_MEMORY_CAPTURE`, `DEVTEAM_STORE`, `DEVFORCE_LAB_*`) are used. Almost no `TODO`/`FIXME` in orchestration / memory / harness-manager / shift-manager / workforce coordinator `src/`.

**Unused-export hygiene (knip, low):** several same-file-only exports in workforce coordinator and `parseSeatReferences`. Not worth a dedicated PR unless bundled with a touch of those files.

[#2930](https://github.com/fixpoint-labs/flow-state-dev/pull/2930) already removed a slice of pre-existing backwards-compat (FIX-850 / FIX-1804). The list above is what remains.

---

## 5. Deferred P2 / nits that never became issues

Scanned review threads on 30 prioritized merged PRs (2026-10-06 → 2026-10-10). GitHub `search/issues` 403’d partway through verification; Linear was used to match named FIX ids. Items below had **no Linear issue** at review time.

### File these (security or user-visible)

| Source | Who | What | Why file |
|--------|-----|------|----------|
| [#2952](https://github.com/fixpoint-labs/flow-state-dev/pull/2952) | jhoffner | “proposing it as a **follow-up issue**” — state and manifest routes on `loadCheckedSession` | Same class as FIX-1616; `get_session` explicitly left open |
| [#2952](https://github.com/fixpoint-labs/flow-state-dev/pull/2952) | jhoffner | `get_session` “still reads **without the compare**. … **proposed follow-up** pending the owner's go-ahead.” | Confirmed still true on `origin/main` (finding 6.1) |
| [#3005](https://github.com/fixpoint-labs/flow-state-dev/pull/3005) | cursor[bot] | `resolveTemplateRaw` still reads template bodies from **unfiltered** `getPersistedData` | Confirmed still true (finding 6.2) |
| [#2985](https://github.com/fixpoint-labs/flow-state-dev/pull/2985) | chatgpt-codex-connector | Shift Manager task panel does not refresh after background settlement | User-visible stale `in_progress` |
| [#2935](https://github.com/fixpoint-labs/flow-state-dev/pull/2935) | chatgpt-codex-connector | Recorders that set `metadata: undefined` silently preserve; public create can seed task-session identity | Board integrity |

### Already tracked (do not refile)

| Thread | Issue |
|--------|--------|
| [#2935](https://github.com/fixpoint-labs/flow-state-dev/pull/2935) reply-holds-conversation | FIX-1834 (Done; also [#2970](https://github.com/fixpoint-labs/flow-state-dev/pull/2970), [#2987](https://github.com/fixpoint-labs/flow-state-dev/pull/2987), [#2990](https://github.com/fixpoint-labs/flow-state-dev/pull/2990)) |
| [#2964](https://github.com/fixpoint-labs/flow-state-dev/pull/2964) store-side earliest expiry | FIX-1843 Backlog |
| [#2964](https://github.com/fixpoint-labs/flow-state-dev/pull/2964) gate-status lookup on cancel fail | FIX-1844 Backlog |
| [#2964](https://github.com/fixpoint-labs/flow-state-dev/pull/2964) continuation crash → paused forever | FIX-1850 Backlog |
| [#2964](https://github.com/fixpoint-labs/flow-state-dev/pull/2964) expired approval + paused turn | FIX-1846 Done ([#2999](https://github.com/fixpoint-labs/flow-state-dev/pull/2999)) |
| [#2985](https://github.com/fixpoint-labs/flow-state-dev/pull/2985) shared module-patch loader | [#2998](https://github.com/fixpoint-labs/flow-state-dev/pull/2998) merged |

### Optional nits (file only if they keep recurring)

[#3003](https://github.com/fixpoint-labs/flow-state-dev/pull/3003) `mutationHandler({ refuse })` / batched roster pass / `worker-entry-keys`. [#3005](https://github.com/fixpoint-labs/flow-state-dev/pull/3005) extract `filterRowsForOwnerKeyMaySeed`. [#2827](https://github.com/fixpoint-labs/flow-state-dev/pull/2827) `owner-private.ts` → `owner-keyed.ts`. [#2984](https://github.com/fixpoint-labs/flow-state-dev/pull/2984) recorded-value `sizeOf` early abort; “Block vs tool name” in the refusal string. [#2715](https://github.com/fixpoint-labs/flow-state-dev/pull/2715) shrink harness-manager README vs site. [#2590](https://github.com/fixpoint-labs/flow-state-dev/pull/2590) shared workspace containment helper; TOCTOU on intermediate path components. [#2557](https://github.com/fixpoint-labs/flow-state-dev/pull/2557) one `isCollectionConfig` predicate / `resolveStorageRef`.

**Follow-up:** One Linear triage pass: file 6.1, 6.2, the two [#2935](https://github.com/fixpoint-labs/flow-state-dev/pull/2935) Codex P2s, and the [#2985](https://github.com/fixpoint-labs/flow-state-dev/pull/2985) panel refresh. Leave the rest in this report.

---

## 6. Security and privacy

Recent work here is strong. [#2952](https://github.com/fixpoint-labs/flow-state-dev/pull/2952) (FIX-1616) bound delete / children / requests / resource-content to `loadCheckedSession`. [#3005](https://github.com/fixpoint-labs/flow-state-dev/pull/3005) (FIX-1568, Done) filters `/state` raw maps with `ownerKeyMaySeed`. Owner-private / owner-writes HTTP fences, `/children` cross-user listing, flow-instance ownership on `/state`, and hire-plane catalog fences all have tests.

Remaining gaps:

### 6.1 `get_session` reloads without the checked session

| | |
|---|---|
| **Severity** | High |
| **Why it matters** | Auth classifies `get_session` as session-addressed (`route-auth.ts`). The handler then calls `loadTenantSession` and **does not receive `checkedSession`**. Sibling routes 404 on incarnation mismatch; this one can 200 with another user’s session JSON after a rebound id. You named this as a follow-up on [#2952](https://github.com/fixpoint-labs/flow-state-dev/pull/2952). |
| **Evidence** | `packages/engine/src/routes/http-handlers.ts`: `get_session` context is `{ registry, stores, tenantId }` only. `handleGetSession` in `session-routes.ts` uses `loadTenantSession`. Re-checked on `origin/main` after [#3005](https://github.com/fixpoint-labs/flow-state-dev/pull/3005). FIX-906 is a broader “principal on routes” backlog, not this slice. |
| **Follow-up** | One engine PR: pass `checkedSession`, use `loadCheckedSession`, add the incarnation-mismatch test the other routes already have. File the issue first if you want it tracked. |

### 6.2 Template reader still uses the unfiltered map

| | |
|---|---|
| **Severity** | High |
| **Why it matters** | `/state` now drops other users’ owner-private rows before snapshot. `resolveTemplateRaw` still does `getPersistedData` → `content[storageKey]` with no `ownerKeyMaySeed`. A `contentTemplateRef` into another user’s owner-keyed row is the same leak class FIX-1568 just closed. |
| **Evidence** | `packages/engine/src/routes/resource-routes.ts` `resolveTemplateRaw` (lines 81–92 on `origin/main`). Review note on [#3005](https://github.com/fixpoint-labs/flow-state-dev/pull/3005). |
| **Follow-up** | Apply the same filter (or refuse the template when `ownerKeyMaySeed` is false). One regression test: two users, `contentTemplateRef` into an owner-private row. |

### 6.3 Unarmed registry in-process `list()` (FIX-1549 POC)

| | |
|---|---|
| **Severity** | Medium, misconfiguration |
| **Why it matters** | If a process registers a wide org collection and never registers the owner-private declaration, in-run `list()` can see other users’ `~owner` rows. HTTP routes still fence. Correctly configured Workforce apps are fine. |
| **Evidence** | `specs/issues/FIX-1549/poc/unarmed-leak/unarmed-leak.poc.test.ts`. Startup overlap refusal when owner-private **is** registered. |
| **Follow-up** | Document in `apps/docs/docs/resources/collections.md`. Optional engine hardening is a spec, not a drive-by. |

### 6.4 Mailbox `author` is display-only

By design (`authorVerified: false`). Members check is roster validity, not identity. Not an HTTP auth bypass. Call it out on the mailboxes page if it is not already obvious.

---

## 7. Tests and CI

### 7.1 Overdue-ask-gate expiry test (FIX-1816, [#3001](https://github.com/fixpoint-labs/flow-state-dev/pull/3001))

| | |
|---|---|
| **Severity** | Low (residual) |
| **Why it matters** | Deflake landed: 5 ms real sleep so a same-millisecond sweep does not see the 1 ms grace as “not yet due.” Still wall-clock, not fake timers. Rest of `stop-suspended.test.ts` uses `vi.useFakeTimers`. |
| **Evidence** | `packages/engine/test/stop-suspended.test.ts` (“an overdue ask gate left pending on a finished turn is expired…”). Commit `139795bd1`. Ran 5/5 green in this environment; full file 37/37. |
| **Follow-up** | Replace the 5 ms sleep with fake timers (park, advance past grace, `runTick`). |

### 7.2 Unpinned `redis:7` in CI

| | |
|---|---|
| **Severity** | Medium (dependency), **rate-limit incidents unconfirmed** |
| **Why it matters** | `test` and `packed-install` pull `image: redis:7` from Docker Hub with no digest and no mirror. BullMQ tests fail-closed when `CI` is set and Redis is missing (`packages/bullmq/test/redis-helpers.ts`). A Hub outage or rate limit fails those jobs. |
| **Evidence** | `.github/workflows/ci.yml` services on both jobs. No in-repo comment about Docker Hub rate limits. I did **not** pull GitHub Actions logs, so I cannot confirm recent `toomanyrequests` failures. |
| **Follow-up** | Pin `redis:7@sha256:…` or pull from `ghcr.io`/ECR. Document in `docs/contributing/development-setup.md`. |

### 7.3 Changeset ↔ Linear id check ([#2963](https://github.com/fixpoint-labs/flow-state-dev/pull/2963), FIX-1532)

| | |
|---|---|
| **Severity** | Low–Medium |
| **Why it matters** | Much tighter than before (branch + title, not description — regression from #1391). Remaining blinds: a PR whose branch/title has no id accepts any well-formed id; **edited** fragments only need some id, not this PR’s. |
| **Evidence** | `scripts/validate-changeset-refs.mjs`, `.github/workflows/changeset-refs.yml`, `packages/core/test/changeset-refs-check.test.ts`. |
| **Follow-up** | Optional: if the PR title has an id, require edited fragments that touch packages in the diff to cite it. Or a one-line PR-template note. |

### 7.4 Coverage on newly merged risky paths

| Path | Coverage | Gap |
|------|----------|-----|
| FIX-1772 recorded-value limit ([#2984](https://github.com/fixpoint-labs/flow-state-dev/pull/2984)) | `packages/engine/test/recorded-value-limit.test.ts` | None needed |
| FIX-1834 / 1836 hold-defer | engine host + concurrency tests; bullmq `*.redis.test.ts` | Relies on Redis CI (7.2) |
| FIX-1840 coordinator CAS ([#2983](https://github.com/fixpoint-labs/flow-state-dev/pull/2983)) | Burst CAS in `projects.test.ts` (`FSD_CONTROL=no-retry`) | No dedicated **coordinator conversation** concurrent-write test |
| FIX-1665 abort fence ([#2971](https://github.com/fixpoint-labs/flow-state-dev/pull/2971)) | Extensive `abort.test.ts`; part 1 of 3 | Cross-process id-reuse races still deferred |
| FIX-1794 conversation filing | `conversation-board-*.test.ts`, shift-manager CoS tasks test, goal `goals/coordinators/files-tasks-down-the-owners-chain/` (not CI) | Goal is on-demand |
| FIX-1802 P1 ([#3003](https://github.com/fixpoint-labs/flow-state-dev/pull/3003)) | On `origin/main`; P2 split / `settleOwed` not in production yet | Keep P2 tests with the P2 PR |
| FIX-1568 /state ([#3005](https://github.com/fixpoint-labs/flow-state-dev/pull/3005)) | Tests added on that commit | Template path still open (6.2) |

Orchestration hand-off tests still use 10–200 ms real sleeps. Convert to gates/promises when next touched (`host-concurrency-hold-defer.test.ts` is the better pattern).

---

## 8. Docs that no longer match the code

| Finding | Severity | Evidence | Follow-up |
|---------|----------|----------|-----------|
| FIX-1786 target copy vs live site | Medium (expected until FIX-1796) | `specs/epics/FIX-1786/DOCS.md` vs `apps/docs/docs/workforce/{overview,projects,inventory}.md` | FIX-1796 P2 |
| `ownerWrites` in architecture, missing from user docs | Medium | `docs/architecture/resources-and-client-data.md`, `docs/contributing/architecture-reference.md`; no `ownerWrites` under `apps/docs/docs/resources/` | One docs PR (FIX-1793 S11 carryover) |
| Ask / follow-up APIs shipped; user docs silent | Medium (and slightly ahead of wiring — 1.3) | `waitForResponse` / `answerTask` / `parkOnQuestion` absent from `apps/docs/docs/` | Docs with FIX-1816 P3, not before the tools are reachable |
| FIX-1786 ER-32 still says “each of the eight” | Medium (spec) | FIX-1815 cross-spec pass asked to amend; `specs/epics/FIX-1786/BUSINESS-RULES.md` ER-32 unchanged | Spec-only PR |
| FIX-1816 `EVOLUTION.md` still says “pending the epic’s record” | Low | Epic recorded child amendments in [#2904](https://github.com/fixpoint-labs/flow-state-dev/pull/2904) | Same spec-only PR |
| `resource-routes.ts` comment: “state routes do not compare against it yet” | Nit | `state-routes.ts` uses `isCheckedSession` after FIX-1616 | Drive-by |
| `resourceVisibility` in user docs, not in `docs/architecture/` | Low | `packages/core/src/types/resource-visibility.ts` | Short architecture addition |

---

## 9. Large files and circular dependencies

Line counts at review HEAD. Growth vs `f00ba5e86` (last commit on 2026-09-18).

### 9.1 Files that grew into review hazards

| File | Lines now | Δ since 18 Sep | Why it matters |
|------|-----------|----------------|----------------|
| `packages/engine/src/context/createExecutionContext.ts` | 4,128 | +250 (50 commits) | `createExecutionContext` itself ~3,600 lines |
| `packages/engine/src/execution/runAction.ts` | 2,941 | +651 (58 commits) | `runActionAttempt` ~1,900 lines |
| `packages/workforce/src/mailbox/mailbox-flow.ts` | 1,961 | new (rename from channel) | `defineMailboxFlow` closure ~540 lines |
| `packages/workforce/src/coordinator/coordinator-flow.ts` | 1,705 | new | Whole coordinator |
| `packages/workforce/src/agent-worker-flow.ts` | 1,492 | +743 | `agentWorkerTurn` ~458 lines |
| `packages/workforce/src/hire.ts` | 1,026 | +638 | `mintSeats` ~461 lines |
| `packages/engine/src/transports/host/createInboundTransportHost.ts` | 1,463 | +467 | Hold/defer, inbound host |
| `packages/harness-manager/src/manager.ts` | 2,355 | +539 | `harnessManager` ~1,245 lines |
| `packages/shift-manager/src/lib/reads.ts` | 857 | new (FIX-1770) | Already the page-reader copy |

Also large and older: `packages/core/src/blocks/generator.ts` (3,455), `sequencer.ts` (2,527). Not last-three-weeks growth.

**Follow-up (engine, one PR each):** (1) extract session / resources / streaming builders from `createExecutionContext`, leave a thin orchestrator; (2) split `runActionAttempt` into `attempt/{setup,execute,finalize,durability}.ts`.

**Follow-up (workforce):** split `mailbox-flow.ts` into post / routing / board-actions once FIX-1792’s mailbox→coordinator conversion lands, so you do not split a file that is about to be deleted.

### 9.2 Import cycles

No madge / dependency-cruiser config in the repo. Ad-hoc `madge --circular` on `src/`:

| Cycle | Severity | Follow-up |
|-------|----------|-----------|
| `agent-worker-flow.ts` → `workers/installation.ts` → `hire.ts` → `workers/worker-flow.ts` → `installation.ts` | High | Extract `workers/types.ts`; keep hire ↔ installation acyclic via a thin register module |
| `task-board/index.ts` ↔ `task-board/flow-policy-wiring.ts` (and several spokes) | High | Move `TaskBoardToolCacheConfig` / board run-state types to `task-board/types.ts` so wiring never imports `./index` |
| Engine: `runAction` → `createExecutionContext` → `create-request-host` → `dispatch-operation` → `runtime-config` → `context/types` → … (18 cycles) | High | First slice: break `context/types` ↔ `runtime-config` ↔ `dispatch-operation` with `context/config-types.ts` |
| Mailbox / coordinator / conversation-board | None among themselves | Coordinator → conversation-board is one-way. Good. |
| Core `.d.ts` barrel cycles | Medium, older | One types-acyclicity PR if publish/tsconfig starts hurting |

---

## What looks healthy

- **Layer 1 does not import Workforce** in orchestration, engine, core, memory, harness-manager, or patterns. Engine’s `workforce-coupling-guard.test.ts` is the right kind of test.
- **Mailbox and coordinator implementations live in Workforce** and compose orchestration’s task board. That is the intended Layer 2.
- **One ledger ending detector** (`endingOf`). The child-finished module is written to be lifted, not copied.
- **FIX-1791 and FIX-1794 are Done.** Coordinator routing and owner-chain filing shipped in stacked PRs with conversation-board tests.
- **Privacy work is landing, not just specified:** owner-private / owner-writes fences, hire-plane catalog, `/children` tenancy, flow-instance ownership, `/state` raw-map filter ([#3005](https://github.com/fixpoint-labs/flow-state-dev/pull/3005)), checked-session on the mutation/list routes ([#2952](https://github.com/fixpoint-labs/flow-state-dev/pull/2952)).
- **D9 was applied, not only written.** [#2841](https://github.com/fixpoint-labs/flow-state-dev/pull/2841) swept child specs; [#2930](https://github.com/fixpoint-labs/flow-state-dev/pull/2930) removed a real compat slice.
- **Goal copies are being collapsed** ([#2939](https://github.com/fixpoint-labs/flow-state-dev/pull/2939), [#2933](https://github.com/fixpoint-labs/flow-state-dev/pull/2933), [#2998](https://github.com/fixpoint-labs/flow-state-dev/pull/2998)), not multiplied.
- **Changeset id check is better** ([#2963](https://github.com/fixpoint-labs/flow-state-dev/pull/2963)). Overdue-ask-gate flake has a real fix ([#3001](https://github.com/fixpoint-labs/flow-state-dev/pull/3001)).
- **Hold/defer reached both the engine host and BullMQ** ([#2970](https://github.com/fixpoint-labs/flow-state-dev/pull/2970), [#2987](https://github.com/fixpoint-labs/flow-state-dev/pull/2987), [#2990](https://github.com/fixpoint-labs/flow-state-dev/pull/2990)) instead of growing a second concurrency story.
- Almost no leftover `TODO`/`FIXME` in the hot packages’ `src/`.

---

## What I could not confirm

- **Docker Hub `toomanyrequests` on `redis:7`.** Image is unpinned. I did not pull Actions logs. Treat 7.2 as “fragile by construction,” not “failed last Tuesday.”
- **Whether any external store still holds `awaiting_review` rows.** Dual-read is in the tree; live data is unknown.
- **Published-npm consumers of `createSkillsCapability` or `PrincipalResolver`.** Repo grep shows no in-repo production callers of the former; the latter is used in-repo.
- **Every deferred nit across all 577 PRs.** Review-thread scan covered 30 high-churn merges. GitHub search 403’d during verification.
- **Runtime reproduction of the `get_session` incarnation race or the template-reader leak.** Both are static: handler wiring + the same pattern FIX-1616 / FIX-1568 already treated as bugs on sibling paths.
- **`graft` graph.** Binary not on PATH in this environment.

---

## Suggested order of attack

1. File Linear issues for 6.1 and 6.2; implement them as two small engine PRs.
2. Finish FIX-1816 P3 (ask wiring + `task-notice` lift). Do not start new ask features until that lands.
3. Finish FIX-1796. Do not open a parallel vocabulary PR.
4. Split `createExecutionContext` / `runActionAttempt` so the next three weeks of engine merges stop stacking into 3k-line files.
5. Optional-peer `fsdev gen`; shared page-reader; convention-md parser; pin Redis.
6. D9 leftovers (`createSkillsCapability`, `agents?`/`catalog?`, `awaiting_review`) once you confirm no consumer.

No source changes accompany this report.
