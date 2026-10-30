# Cycle 28 — "One term, one thing: the coordination renames" epic wrap (FIX-2071) (2026-10-30)

Part of the [cycle ledger](../cycle-ledger.md), whose header defines the feedback classes and reading labels.

**A rename epic: one epic spec, one child spec, seven rename PRs and a closure. The implementation load was
the lowest in many cycles (10 waves over 8 PRs, none past two). The rework that leaked was in the
review comments nobody answered. Every inline thread from Codex, Cursor and GitHub got a reply. Eight of
the ten "Second look + architecture pass" comments got none, and at least five of their findings are on
`main` now.**

The classes, checked against the PRs:
- **(a) A second-look comment posted under the shared login was never handled.** All ten carry no `eyes`
  reaction. Only #3985 (the epic, folded at b2a571e7) and #4090 (folded at db0aa31) got a reply. The
  other eight (#4029, #4077, #4092, #4098, #4093, #4095, #4128, #4244) merged without one. The likely
  cause is `issue-implement` 10.1. It says *"Ignore comments authored by us"*. The second look posts
  under `jhoffner`, the same login as the PR and as every agent reply, so a login check reads it as our
  own. Cursor, Codex and `github-code-quality` post under their own logins, and every one of their 40
  inline findings got a reply (the 41st thread is praise). `epic-wake` already says the same login
  problem out loud for approvals
  (*"Agents post as the owner, so login and `MEMBER` cannot tell them apart"*, `classifyApprovalArtifacts`).
  10.1 has no such rule. What it left on `main`, re-checked at 5b08b5809:
  - #4098: `docs/contributing/architecture-reference.md:78` still says `isInProcessDispatcher`, in the
    locked-contracts page. `.agents/workflows/issue-multi-pr.js:16` still says `topologicalDispatcher`.
    The flow runner is still called a dispatcher at `packages/core/README.md:773`,
    `apps/docs/docs/server/background-work.md:127` and `apps/docs/guides/background-jobs-bullmq.md:179`.
    The test title at `packages/bullmq/test/scaffold.test.ts:34` still says dispatcher.
  - #4095: `.changeset/shift-coordinator-name.md:5` says *"The worker's id is still `chief-of-staff`"*,
    and `.changeset/shift-coordinator-worker-id.md` says it is `shift-coordinator`. Both are pending for
    `@flow-state-dev/shift-manager`, so the next release notes will say both.
  - #4128: `budget` now names two things in `packages/workforce/src/messages/message-received-entry.ts`:
    the chain's cap (line 191) and what is left of it (line 202). Before the rename, `hopLimit` and
    `budget` kept them apart. The rename made one word mean two things in the epic about one word per thing.
  - #4029 finding 1 said a model would misuse `updateTask({ answers })`. It went unanswered, and #4077's
    Codex P2 found that case: the tool description still taught `question`.
  - #4244 asked to file the stale-path class (see (c)). The PR said *"Nothing filed"*.
  New as a named mechanism. Merging with a finding open recurs from cycles 16–19, 26 and 27.
- **(b) "Reject the renamed key by name" was found again in each child.** It came up four times, in three
  children. Codex P2 on #4098 (`dispatcher` → `runner`, and the board's `dispatcher` → `claimOrder`).
  Codex P2 on #4128 (`hopLimit` → `budget`). Codex P2 on #4077 (`question` → `answers`, which drew the
  `answers_not_question` refusal). The second look on #4093 (`human_*`, unanswered, no refusal on
  `main`). BP-030's second bullet already says it: *"Renaming or removing a key from a public config
  object: reject the dead key with an error pointing at the replacement."* The epic's D1 settled BP-030
  as *"met by the reset, not by a dual read"*. A store reset answers the dual-read bullet only, and
  `renames.md` has no column for a key a caller passes in. So the rule was written but nobody applied it
  at the epic, and Codex found it again in each child. Each fix wrote its own refusal (see the job audit).
- **(c) Live files under a path the renames treat as history.** The codemods skip `specs/` as history.
  FIX-1792's `specs/issues/FIX-1792/poc/inventory/check.mjs` is read at runtime by
  `goals/coordinators/every-coordinator-is-a-worker-file/run.mts:34`. FIX-2244's codemod left two old
  goal paths in it. #4090 then needed a special case for the same file (Codex P2, 7dee65bd). It saw the
  two FIX-2244 leftovers and called them *"not from this PR"*, and the closure fixed them by hand
  (#4244). The sweep's roots leave out `docs/contributing/` and `.agents/`, which is why (a)'s #4098
  leftovers passed it. All `stale-restatement`.
- **(d) A stale head merged and turned `main` red.** #4093 (FIX-2151) merged at 21:55Z on a head that had
  last merged `main` at 21:38Z. FIX-2157's #4094 had merged at 21:51Z with a `human_input` the new
  `human-reasons` row refuses. `main`'s sweep stayed red until #4095 carried the fix, merging at 23:33Z
  (about 1h38m). Recurs from cycle 27 (c) and cycle 24 (c). **An owner ask, not text:** require
  up-to-date branches, or a merge queue. Both are still open.
- **(e) The epic PR's rows were drafted from the gaps file, not from `main`.** Round 1 of #3985 found
  rows that matched the code only on paper (Architect 1–3, second look 1–2). `RUN_BOARD_ENTRY` was
  already `DISPATCH_ENTRY`. `retryOf` named the engine's request re-run. `reopen*` was already
  `followUpOf`. Two old-spelling readers had no row. Rounds 2 and 3 were changes made by the sibling
  epic FIX-2070: the owner renamed `receive` to `onMessageReceived` in that epic, and its closure FIX-2242 (#4024) took
  the message rows. All of these are `stale-restatement`, the epic-PR class cycle 2 named. The third round
  came from outside this spec, so it is not this spec's direction finding.

**Proposal:** one change for (a), and a sharpening of BP-030 for (b). Neither is built in this PR.
(c) is folds. (d) is an owner ask. (e) is scored, with nothing new proposed.

**Method: scope.** 10 reviewed artifacts, all named in the wrap brief and read over the GitHub API
(reviews, review threads, conversation comments, commits). Linear was not read: the brief listed the
set, and every child is merged.
- **Direction artifacts (2):** #3985 (the epic spec), #4029 (FIX-2183).
- **Rename implementation (7):** #4077 (FIX-2183), #4092 (FIX-2243), #4098 (FIX-2245), #4093
  (FIX-2151), #4095 (FIX-2244), #4128 (FIX-2246), #4090 (FIX-2248).
- **Closure (1):** #4244 (FIX-2249).

**Out of the sample:** #4094 (FIX-2157) and #4024 (FIX-2242) are the other sides of (d) and (e), not
this epic's work.

**Endpoints and rounds.** As cycle 27: direction artifacts end at the owner's merge, and a **round** is a
distinct reviewer pass that drew a thread or a hold. Implementation **waves** are distinct passes that
drew a thread, clustered by reviewed head. A "Second look + architecture pass" comment is one review
body (cycle 19). Classes come from the lead point of each finding and are approximate (about ±10%).
Times are UTC.

**Every act sits behind the shared `jhoffner` login**, so this entry doesn't say who merged what. In
this cycle that login is also the cause of (a).

### Direction artifacts

| PR | Rounds | Endpoint | Points | Lead classes | Shape of the review | Felt off? |
|---|---|---|---|---|---|---|
| [#3985](https://github.com/fixpoint-labs/flow-state-dev/pull/3985) epic FIX-2071 | **3** (r2, r3 from FIX-2070) | merge 10-28 01:55Z | ~25 | stale-restatement · missed-edge-case | r1: the Architect held on three rows that matched the code only on paper (e). The second look added the `postId` / `taskId` collision and the `reopen` collision. Cursor's six notes were recorded for implementers, one of them a table-to-`RETIRED` coverage check. All folded at b2a571e7. r2: the owner's `onMessageReceived` call. r3: #4024 took FIX-2070's rows | no |
| [#4029](https://github.com/fixpoint-labs/flow-state-dev/pull/4029) spec FIX-2183 | 1 | merge 10-28 12:10Z | ~16 | missed-edge-case · spec-ambiguity | Codex P2 (keep `answer(item)` beside `answerOne`), folded at e5b8986. The epic-side check flagged a row conflict, and Cursor's six notes were answered. **The second look's seven points got no reply (a)**, and its first one turned up again in #4077. Codex's status on e5b8986 still reads *running* | no |

### Rename implementation and closure

| PR | Waves | Inline threads | Shape of the rework | Second look answered? |
|---|---|---|---|---|
| [#4077](https://github.com/fixpoint-labs/flow-state-dev/pull/4077) FIX-2183 | 1 | 7 | Codex P2: the `updateTask` description still said `question`, and an old call passed as a message (now `answers_not_question`, b). Cursor: derived names left (`defaultFiledWorkHolds`, `answerRowHold`), module headers, `generateId("hold")`, codemod paths | **no** — `holdIds` is still at `questions.test.ts:68` |
| [#4092](https://github.com/fixpoint-labs/flow-state-dev/pull/4092) FIX-2243 | 1 | 4 | Cursor: one bundled `task-tool-names` row, codemod skip lists. CI went red when #4077's base brought a new `addTask`. The codemod was re-run on the new base (ER-2 working as written) | **no** (optional points) |
| [#4098](https://github.com/fixpoint-labs/flow-state-dev/pull/4098) FIX-2245 | 2 | 5 | w1: Codex P2 found the docs still teaching `dispatcher`, and the glossary too. w2: Codex P2 found a `dispatcher` key silently ignored (b). Cursor: `FlowRunner as FlowRunner` re-export aliases | **no** — six leftovers on `main` (a), and the roots gap (c) |
| [#4093](https://github.com/fixpoint-labs/flow-state-dev/pull/4093) FIX-2151 | 1 | 4 | Codex P2: a codemod re-run rewrote its own release note. Cursor: the scope of "total". **Merged on a stale head (d)** | **no** — no runtime refusal for `human_*` (b) |
| [#4095](https://github.com/fixpoint-labs/flow-state-dev/pull/4095) FIX-2244 | 1 | 6 | Cursor ×5, on codemod rule order and a local name. Its merge from `main` fixed (d)'s red sweep | **no** — the pending-changeset contradiction is on `main` (a) |
| [#4128](https://github.com/fixpoint-labs/flow-state-dev/pull/4128) FIX-2246 | 1 | 1 | Codex P2: a `hopLimit` key silently ignored, and more messages allowed than configured (b) | **no** — `budget` names two things (a) |
| [#4090](https://github.com/fixpoint-labs/flow-state-dev/pull/4090) FIX-2248 | 2 | 4 | w1: Cursor flagged the triplicated name list, and the second look's two points were folded. w2 (10-30): Codex P2 found FIX-1792's inventory is a live consumer under `specs/` (c) | yes |
| [#4244](https://github.com/fixpoint-labs/flow-state-dev/pull/4244) FIX-2249 | 1 | 4 | Cursor ×4 (wording, a leg label, a fixture copy). The QA run found (c) | **no** — the empty-desk assertion, and "file the class" |

**Load.** 10 waves over 8 implementation PRs; none took more than two. Direction: 4 rounds over 2
artifacts; one took three, two of them from the sibling epic.

**Classes.** Direction (~41 points): `stale-restatement` leads (#3985's rows, rounds 2–3), then
`missed-edge-case` (collisions) and `over-engineered` (Cursor's notes, recorded). No `design-off`.
Implementation (~75 points): `stale-restatement` leads (about 25: a renamed name left in prose, a
string, a path, a header or a changeset), then `missed-edge-case` (about 9: (b) ×4, #4093's own release
note, #4090's live consumer, #4128's `budget`, #4244's empty desk, #4095's stored old id). The rest are
`over-engineered` (dedupe notes) and `nit`. Reading labels: `vacuous-assertion` on 1 (#4244: the
old-name leg passes on an empty desk too; unanswered). `overclaim` on 1 (#4098: the sweep's PASS read
wider than its roots).

**Claims (looped / settled / verdicts):** 0 / 0 / —.

**Reviewer exhaustion:** none. **Merged with a finding open:** the eight PRs in (a).

**Carried / not carried.** Cycle 26's fix (d0a6de9a, the BP-035 line) is an ancestor of #3985's base
(d44f19f51), so every PR here carried it. Cycle 27's proposal (the `epic-wake` round-4 step) has not
landed: `epic-wake.js` has no commit since 10-29.

**Epic row:**
`ways per job: file a task 2→1 · read a task by id 2→1 · cancel a task 2→1 · list a task's open asks
2→1 · answer a task's question from the Inbox 2→2 · say what keeps a running task open 1→1 · order a
board's claims 1→1 · choose where a flow action runs 1→1 · name the coordinator worker 1→1 · mark a stop
as the user's 1→1 · route a user's message to a delegate as a task 1→1 · cap a message chain 1→1 ·
build a worker's session and filing tools 1→1 · open a worker flow's door 2→1 · read a stored old
spelling at replay ≥4→0 · refuse a renamed or removed option by name 4→8 · refuse a retired name in CI
3→3 · rename identifiers across the repo 1→8`

## (a) The comments that went unanswered

| PR | Second-look points | `eyes` | Reply | Still on `main` (5b08b5809) |
|---|---|---|---|---|
| #3985 | 6 + 3 restraint | 0 | yes, folded | — |
| #4029 | 7 | 0 | no | point 1 recurred in #4077; point 6 was done in #4077 |
| #4077 | 5 (nits) | 0 | no | `holdIds`, `questions.test.ts:68` |
| #4092 | 4 (optional) | 0 | no | the pool's `addTask` (kept on purpose by the table) |
| #4098 | 5 + roots gap | 0 | no | six lines (above) |
| #4093 | 4 | 0 | no | no runtime refusal for `human_*` |
| #4095 | 5 | 0 | no | `.changeset/shift-coordinator-name.md:5` |
| #4128 | 5 | 0 | no | `budget` ×2 meanings |
| #4090 | 2 | 0 | yes, folded | — |
| #4244 | 5 | 0 | no | the class in (c), unfiled |

The two that got a reply were each answered by an agent that was reading the whole conversation for
some other reason: the epic agent folding two reviews together, and a worker that was already
answering Cursor. The PR-feedback loop never put the `eyes` mark on any of the ten. It puts that mark
on every comment it handles (10.2). The PR author's own `@claude resolve conflicts` comments did get
`eyes`. Read with 10.1's *"Ignore comments authored by us"*, the second look looks like the PR
author's own comment.

## Enforcement, rung by rung

**(a) Unanswered second look.**
- *Rung 1, architecture: an owner ask.* Post the second look under its own identity (a GitHub App or a
  bot login, as Cursor and Codex have). Then "authored by us" is true by login, and the comment is
  handled like the 40 bot findings that all got answers. No skill text changes.
- *Rung 3, a check: proposed, not built.* Before `epic-wake` or `issue-lifecycle` reports a PR ready to
  merge, it counts the PR's non-bot conversation comments that have no `eyes` from the loop and no
  reply. Against this cycle the check fires on the eight PRs and stays quiet on #3985 and #4090
  (replied, so "no reply" is false). The `@claude` trigger comments carry `eyes`. It touches
  orchestration's control flow, so it goes to the owner first.
- *Rung 5, prose, if neither lands:* sharpen 10.1's exclusion to *"Ignore your own replies: a threaded
  reply you posted, or a conversation comment that answers one. Under the shared login a review body
  (a second look, the Architect) is feedback."* The tool exists (`hasAgentAuthoredMarker`), but the
  second look carries no header, so the marker can't tell it apart today.

**(b) Renamed keys, rung 1: a fold, plus a BP-030 sharpening.** One `refuseRemovedOptions(options,
{ key: message }, where)` helper would make "add the old key to the table" the obvious step for the next
rename (job audit, F1). The leftover judgment is a rename spec deciding which of BP-030's halves
applies. It lands as one sentence in BP-030's second bullet, proposed text: *"A store reset meets
the dual-read bullet only. A renamed key a caller passes (an option, a tool parameter, a config field)
is still refused by name."* That is landing altitude 2, a sharpened existing BP. No new BP.

**(c) Live files under history, rung 1: folds.** Move each check a goal or script runs out of `specs/**/poc/`
into its consumer (F5), and widen the identifier rules' file scope to `docs/contributing/` and `.agents/`
(F3). Proof that F3 goes red on a real past mistake: `dispatcher-names` matches `isInProcessDispatcher` and
`topologicalDispatcher`, and today `architecture-reference.md:78` and `issue-multi-pr.js:16` hold one each.
Adding the two trees to `ROOTS` alone fails *totality*: 99 files under them match no rule. So the identifier
rules' `files` need the two trees too, not just `ROOTS`.

**(d) Stale head, rung 1: an owner ask,** as in cycle 27.

## Accepted and Rejected

**Accepted (for the owner's review on this PR):**
- (a): the owner ask for a separate second-look identity, and the rung-3 readiness check, not built.
- (b): the BP-030 sentence above, not written into `best-practices.md` here.
- Job audit: folds F1–F7, for the coordinator to file.

**Rejected:**
- *A new BP for (a) or (b).* (b) is BP-030's own second bullet; (a) is one line in an existing skill.
- *Making the second look block merge.* Most of its points are optional by its own words. The defect is
  that no one answered them, not that they didn't block.
- *A table-to-`RETIRED` coverage check (Cursor on #3985).* The closure's planted run did that job once
  (58 of 62 caught; the other four explained), and `RETIRED` is not expected to grow again soon.
- *(d) and (e) as text.* (d) is a repository setting. (e) is the class cycle 2 named, and this epic
  spec's round 1 caught it before any child built.

## Job audit

The PR body lists every addition the batch made and the job it does. D2 made `renames.md` the contract
for six children, so it stands in for their specs' question 7. FIX-2183's spec counted its own Adds
(two sweep rows). A rename is N→N, and a fold is N→M with M below N. Fourteen of the eighteen jobs are
renames or folds, and their counts are the table's. The four jobs below had additions from more than
one PR, or additions no spec recorded, so each was checked on `main` across packages (by `git grep`,
listed here):

- **refuse a renamed or removed option by name, 4→8.** Before: `assertNoRemovedGuards`
  (`orchestration/src/tasks/collection/internal.ts:706`), `announce` in `harness-manager/src/manager.ts:1413`,
  `onReview` in `orchestration/src/task-board/index.ts:747`, and the `REMOVED_OPTIONS` table in
  `scheduled/src/createScheduledTransportAdapter.ts:30`. Added by this batch, and named by no spec:
  `refuseRetiredDispatcherOption` (`engine/src/transports/runner.ts:178`, called from four entry
  points), the board's `dispatcher` check (`task-board/index.ts:759`), `hopLimit`
  (`workforce/src/messages/message-limits.ts:31`), and `answers_not_question`
  (`orchestration/src/skills/task-tools-capability.ts:1469`). Each one is hand-written. **Fold: F1.**
- **refuse a retired name in CI, 3→3.** `one-word-per-thing`, `check-retired-terms` (its `goal-names`
  exception deleted) and `runs-on-one-task`. FIX-2056's removed task tools are now refused by two of
  them: `task-tool-names` in `RETIRED`, and `runs-on-one-task`'s `REMOVED`. Cursor raised it on #4092,
  and the answer was *"bundled on purpose"*. **Fold: F7** (low).
- **rename identifiers across the repo, 1→8.** `rename-sequencer-then-to-step.ts` before, and seven
  one-shot codemods after. ER-2 told the second child to extract a shared `renameIdentifiers` helper,
  and none did: the children landed together, and each said the next one's names did not overlap. The
  codemods exist so a conflicting PR can be regenerated, and none is left in flight. **Fold: F6**
  (low). Delete them or consolidate them, whichever the owner prefers.
- **read a stored old spelling at replay, ≥4→0.** `upgradeWorkerEntryNames`, `legacyPostRowId` and the
  two `ask` readers are gone from `packages` and `apps` (no hit off a `retired-name-refusal` line). This
  job is a fall, as D1 intended.

The renames that left a second meaning or a stale copy behind, found by checking the jobs above:

- **cap a message chain, 1→1,** but `budget` now names both the cap and what is left of it.
  **Fold: F2.**
- **choose where a flow action runs, 1→1,** but six places still call the runner a dispatcher.
  **Fold: F3**, which also widens the identifier rules' file scope.
- **name the coordinator worker, 1→1,** but a pending changeset still says the old id stands.
  **Fix: F4.**
- **live checks under retained specs:** three are read at runtime. They are FIX-1792's inventory (by
  `goals/coordinators/every-coordinator-is-a-worker-file/run.mts:34`), FIX-2162's caller census (by
  `goals/client/does-every-job-with-one-client/check.mjs:111`) and FIX-1428's copy census (by
  `scripts/validate-reserved-names.mjs:62`). **Fold: F5.**

## Scoring the previous cycle's claims

- **Claim 1 (interleaving tails named by round 4):** not measured. No implementation PR reached four
  waves, and none had a chain on one structure.
- **Claim 2 (event read off a state, carried):** 0, in 8 carried PRs. Baseline 2 in 1. A rename adds no
  rules, so this is a weak sample.
- **Claim 3 (stale-head merges that turn `main` red):** 1 PR, a red window of about 1h38m (d). Baseline
  2 PRs and about 1h48m. Two more PRs (#4128, #4090) waited on a `main` that other work had turned red
  (lab inventory tables, #4159/#4163 and #4200).
- **Claim 4 (direction artifacts merged before their requested Codex pass):** 0 of 1 known. #3985
  merged two minutes after Codex finished on its head. #4029's last Codex status still reads *running*,
  so it can't be scored.

## Claims to test next cycle

1. **Second-look comments answered.** For each PR with a second look, record whether it got `eyes` and a
   reply before merge. Baseline: 2 of 10. If the identity change or the readiness check lands, expect
   all of them.
2. **Renamed keys refused in the first cut.** For each PR that renames an input key, record whether its
   first reviewed head refuses the old key, or a reviewer had to ask. Baseline: 0 of 4.
3. **Stale-head merges that turn `main` red.** Baseline: 1 PR, about 1h38m.
4. **Interleaving tails named by round 4** (cycle 27's claim 1, carried over).
