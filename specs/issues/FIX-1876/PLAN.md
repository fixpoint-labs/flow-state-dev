# FIX-1876 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Written for the implementing agent. Discipline: rename, read both names where a record outlives a
deploy, sweep. **No behaviour changes** ([ER-8](../../epics/FIX-1870/BUSINESS-RULES.md#what-no-child-may-do)).
Starts when FIX-1875 and FIX-1872 have both merged. Rule IDs are [BUSINESS-RULES.md](BUSINESS-RULES.md)'s.

## Surfaces

| ID | PR | Where | Change |
|---|---|---|---|
| S1 | P1 | `packages/core/src/types/ask-gate.ts` → `wait-gate.ts`, its exports from `core` and `core/types` | The wait gate family, per [the map](#pinned-names). `isWaitGate` accepts `"wait"` and, marked, `"ask"` (WR-9) |
| S2 | P1 | `packages/core/src/types/request-host.ts` | `resumeAsk` → `resumeWait`, its input and result types |
| S3 | P1 | `packages/engine/src/durability/` (`resume-ask-gate.ts`, `ask-deadlines.ts`, `durability-sweeper.ts`, `stop-suspended.ts`), `context/ask-resume-operation.ts`, `context/create-request-host.ts`, `execution/runAction.ts`, `routes/resume-routes.ts` | Renames only. Every test of a gate's kind goes through `isWaitGate` (G1). The route keeps refusing old gates (WR-10) |
| S4 | P1 | `packages/orchestration/src/tasks/helpers/wait-for-response.ts`, `tasks/schema/task.ts`, `tasks/schema/task-init.ts`, `tasks/notice/task-notice.ts`, `skills/task-tools-capability.ts`, `src/index.ts` | `row.ask` → `row.wait`, read through one reader that accepts both (WR-8). The `fsd.ask.*` keys, the `ask:` gate-id prefix and the notice's `asked` flag keep their spelling (D2, WR-11 to WR-13); the identifiers that build them are renamed. The task listing's `asked: true` (a tool output, not stored) becomes `waitedOn: true`. `resumeOwedAsks` → `resumeOwedWaits` |
| S5 | P1 | `packages/workforce/src/conversation-board/` (`board.ts`, `task-settled.ts`) | Callers of S4's renames. `taskNoticeSchema` in `task-settled.ts` is strict and declares `asked` itself; it keeps that key (WR-13) |
| S6 | P1 | `goals/hand-offs/ask-survives-a-restart/run.mts` | The one read of a row's `ask` becomes `wait`, listed in the rename map (WR-19). Nothing else in a regression check changes |
| S7 | P2 | `packages/orchestration/src/task-board/hand-off.ts` → `dispatch-assignee.ts`, `blocks/hand-off.ts` → `blocks/dispatch-row.ts`, `index.ts`, `task-entry.ts`, `park-exit.ts`, `quiescence.ts`, `blocks/board-meta.ts` | The dispatch family, per the map. The board's ending writes `"dispatched"`; its type and every reader accept `"handed-off"` too, marked (WR-14) |
| S8 | P2 | `packages/claude-code`, `packages/harness-manager`, `apps/kitchen-sink` | Callers and comments that name the S7 symbols |
| S9 | P1, P2 | Each package's tests under `test/`, and `packages/integration-tests` | Renamed with the code they test, file names included (`ask-*.test.ts`, `*hand-off*.test.ts`). Assertions unchanged |
| S10 | P1, P2 | Published pages and READMEs that name a symbol the PR renames | Fixed in the same PR, so no merge leaves a page naming a symbol that is gone |
| S11 | P3 | `apps/docs/docs/glossary.md`, `orchestration/task-board.md`, `server/background-work.md`, `guides/background-work.md`, `guides/keeping-a-flow-running.md`, `docs/architecture/dispatched-work.md`, the package READMEs | [DOCS.md](DOCS.md)'s text, then every remaining phrase use the sweep lists |
| S12 | P3 | `.changeset/post-to-mailbox-tool.md`, `routed-mailboxes.md`, `mailboxes-everywhere.md` | Amended so they don't announce a removed tool (WR-7) |
| S13 | P1, P2 | `.changeset/` | One `minor` fragment per PR for `core`, `engine`, `orchestration`: each renamed export as `old → new`, and for P2 the ending's new value first (WR-16, WR-17) |
| S14 | P3 | `goals/vocabulary/one-word-per-thing/`, `.github/workflows/ci.yml` | The sweep and its rules, moved from this spec's `poc/`, with a `goal.md`. Run with `--control` in CI's Process guards beside `check-retired-terms.mjs` (WR-24) |
| S15 | P1 | `packages/integration-tests/src/scenarios/` | Leg 2: a wait parked under the old marks on SQLite resumes on the new build (the goal's second leg) |

**Removed:** the files renamed above under their old names; no export alias (D1). **Kept on
purpose:** `isTaskDispatcher`, `dispatcher()`, `TaskDispatcher` (already dispatch);
`abortHandoff` and the engine's request-record hand-over unless rewording is cheap (WR-5); every
person ask (WR-3); the board's `onIdle: "wait"` (WR-23); the three internal wire values (D2); FIX-1872's
refusal of a worker file naming `handOff`, marked `retired-name-refusal` (WR-25). Each one the sweep flags has a
keep-list entry in its rules or the marker.

## Sequence

```mermaid
flowchart TD
  U["FIX-1875 and FIX-1872 merged · re-run the sweep · drop what they renamed"] --> P1["P1 · wait family · S1 to S6, S9, S10, S13, S15"]
  P1 -->|"sweep --only ask · OPEN 0"| P2["P2 · dispatch family · S7 to S10, S13"]
  P2 -->|"sweep --only handoff · OPEN 0"| P3["P3 · published words · S11, S12, S14"]
  P3 -->|"full sweep · OPEN 0 · control FAILS"| D["done · the closure's docs walk"]
```

One PR at a time, each merged before the next opens, because P2's pages and P3's narrative name
what the earlier PR renamed.

## Pinned names

The rename map. The closure's script reads this table ([ER-11](../../epics/FIX-1870/BUSINESS-RULES.md#what-no-child-may-do)).
A name FIX-1875 or FIX-1872 already renamed keeps their choice (WR-22).

| Old | New | Stored? |
|---|---|---|
| `ASK_GATE_REASON = "ask"` | `WAIT_GATE_REASON = "wait"` | Yes: read both (WR-9) |
| `isAskGate` · `AskGateBinding` · `AskOutcome` · `AskEndingErrorCode` | `isWaitGate` · `WaitGateBinding` · `WaitOutcome` · `WaitEndingErrorCode` | — |
| `recordedAskOutcome` | `recordedWaitOutcome` | — |
| `AskEndedError` · `AskStoppedError` | `WaitEndedError` · `WaitStoppedError` | — |
| `parkOnAsk` · `ParkOnAskInput` · `parseAskOutcome` | `parkOnWait` · `ParkOnWaitInput` · `parseWaitOutcome` | — |
| `RequestHost.resumeAsk` · `ResumeAskInput` · `ResumeAskResult` | `resumeWait` · `ResumeWaitInput` · `ResumeWaitResult` | — |
| `resumeAskGate` · `AskResumeOperation` · `createAskResumeOperation` · `hasAskSweeper` and the engine's other `*Ask*` internals | the same with `Wait` | — |
| `resumeOwedAsks` · `askGateId` | `resumeOwedWaits` · `waitGateId` | — |
| `Task.ask` | `Task.wait` | Yes: read both (WR-8) |
| `fsd.ask.step:` · `fsd.ask.plan:` · `fsd.ask.file:` | kept | Yes: a wire value, kept (D2, WR-11) |
| gate id `ask:<board>:<task>#…` | kept | Yes: a wire value, kept (D2, WR-12) |
| `TaskNotice.asked` | kept | Yes: a wire value, kept (D2, WR-13) |
| task listing's `asked: true` | `waitedOn: true` | No: a tool output |
| `createHandOff` · `HandOffOptions` | `createRowDispatch` · `RowDispatchOptions` | — |
| `HandOffAssignee` · `handedOffTaskPredicate` | `DispatchingAssignee` · `dispatchedTaskPredicate` | — |
| `assertHandOffBoardSupported` · `assertHandOffBlockSupported` | `assertDispatchBoardSupported` · `assertDispatchEntrySupported` | — |
| board handle field `handedOff` | `dispatchers` | — |
| board ending `"handed-off"` | `"dispatched"` | Yes, in item logs: read both (WR-14) |
| dispatch block output `handedOff: true` | `dispatched: true` | Yes, in item logs: read both (WR-14) |
| docs section *Assignees that hand off* | *Assignees that dispatch*, with `#assignees-that-hand-off` kept as an anchor (WR-18) | — |

## Checks

| Check | Proves | Fails when |
|---|---|---|
| C1 · the sweep, per family then full, and in CI from P3 | WR-1 to WR-7, WR-15, WR-20 to WR-25 · D1 | An open line, a file with no rule, or an unmarked old name |
| C2 · `--control` | The sweep can fail | It passes with a planted `parkOnAsk` |
| C3 · Leg 2, the upgrade scenario on SQLite | WR-8 to WR-13 · D2 | The turn doesn't resume with the answer, the board holds two rows, or the public route resumes the old gate |
| C4 · Leg 2 with the legacy readers stubbed out | C3 depends on them | It passes |
| C5 · unit checks with an old record, one per reader: the sweeper, the resume path and the public resume route with an `"ask"` suspension, a row reader with `ask`, a board reader with a `"handed-off"` log | WR-8 to WR-10, WR-14 | A reader drops the old name |
| C6 · `pnpm typecheck` and `pnpm test` | WR-16 and no behaviour change | Anything fails; no assertion is edited beyond names |
| C7 · the docs build (`onBrokenAnchors: "throw"`) | WR-18 | The old anchor or a renamed link is broken |
| C8 · the epic's regression checks on the P1 commit | WR-19 | FIX-1816's check fails after its one-line rename |

## Guardrails

- **G1 · One reader per renamed stored mark.** The wait gate's kind is tested only through
  `isWaitGate`, the public resume route included, never by comparing the reason string; a row's
  wait only through one reader. *Because* a
  legacy read added at one call site and missed at another is the failure the sweep can't see:
  the sweeper and the public route both test a gate's kind, and missing the route is a security
  regression (WR-10). Find every caller with the sweep, not by memory ([tenet 5](../../../docs/philosophy.md#5-fix-at-the-owning-layer)).
- **G2 · Names only.** *Because* the epic's proof is that nothing changed but names; an edit to an
  assertion, a branch or a default is a finding, not a fix (ER-8, ER-11).
- **G3 · Mark every deliberate retired-name line, a legacy reader or a refusal, with `retired-name-refusal` and the rule it serves.** *Because* the sweep
  counts them, and a later cleanup finds them by the marker. It is FIX-1875's marker, so the
  repository has one spelling for a deliberate old name, whether it reads one or refuses one (WR-25a).
- **G4 · A writer never writes an old name of a renamed mark.** *Because* reading both is only safe
  if new records are unambiguous (WR-15). The kept wire values are written as today.

## Docs

[DOCS.md](DOCS.md) is the draft: the glossary rows, the task board's renamed section, the waiting
paragraph in `background-work.md`, the guides' sentences and the architecture doc's terms. P1 and
P2 fix any page that names a symbol they rename (S10); P3 publishes the rest.

## POC

[`poc/vocabulary-sweep/`](../../../goals/vocabulary/one-word-per-thing/goal.md): the inventory checker. **Showed:** on
`main` at `da8f63fd7` it scans 3,749 of 4,100 tracked files, excludes 351 by named rules, leaves
none unruled, and finds 2,156 open lines in 289 files; the planted control fails as it should.
Premise it settled: the issue's list is a small part of the job ([DECISIONS → Settled](DECISIONS.md#settled)).

## At implement time

- **Re-run the sweep first** on the merged FIX-1875 and FIX-1872 commit. Their renames drop out; the
  coordinator's `handOff` tool should already be gone; its load-time refusal stays, marked (WR-25).
  If either merged a name that uses *wait* or *dispatch* in another meaning, add it to P1's map
  (WR-22).
- **Finish the keep list** before renaming: classify every person ask (Shift Manager, the harness
  inbox, approvals, the chief of staff) and every unrelated "hand off" (WR-3, WR-5), each with its
  reason. Then everything left is a rename.
- **Check the old anchor** renders as a target in Docusaurus; if an inline `<a id>` doesn't
  register with the broken-anchor check, use the heading's explicit id syntax instead.
- **Pick the reader shape for `Task.wait`**: a schema that accepts `ask` on read and writes
  `wait`, or an accessor. Either satisfies G1.

## Follow-ups

- **Drop the legacy readers** once no deployment can hold a pre-upgrade wait (D2). Owner: whoever
  ships a store migration runner.

## Notes from review

Recorded verbatim from PR #3141, round 1, for the implementer. Not baked into the design.

- **Architect · Layer 1 lens:** "It's worth one line in S3 saying the route must call `isWaitGate` and never compare against the reason string directly." (Folded into G1.)
- **Second look · merge-conflict window:** "About 290 files across three serial PRs, with concurrent work landing on `main`. Cut P1 and P2 immediately after FIX-1875/1872 merge. Regenerate the rename with the PLAN's map script rather than hand-resolving conflicts."
- **Second look · `Task.wait` shape:** "If the row schema accepts `ask` on read and writes `wait` (a preprocess), that is the one reader G1 asks for. An accessor leaves raw `row.ask` readable from other call sites. Prefer the schema."
- **Second look · reach of D1:** "Identifiers, exports, stored marks and published text clearly pay for themselves. The roughly 970 prose "hand-off" phrases in comments and tests are the low-value, high-churn part. I'd still do them because the sweep makes them mechanical, but if the review wants to cut, cut there first."
- **Cursor · custom sweep vs existing guards:** "If this ever graduates beyond an on-demand goal, I'd extract shared "tracked tree + area classification" into `scripts/lib/` rather than a fourth copy of `AREAS`/`EXCLUDE` tables, and wrap the goal with `goals/lib/verdict.mts` (thin `run.mts` delegating to `sweep.mjs`)." It now runs in CI (S14), so this applies at P3. After P3, glossary row uniqueness for the new terms should hook the existing glossary checks in `check-retired-terms.mjs`.
- **Cursor · D3:** "Re-gate D3 after FIX-1875 and FIX-1872 merge (your own flip condition): if upstream absorbs most of the wait family, P1+P2 → one code PR + P3 docs is strictly simpler with the same end state."
- **Cursor · keep-list timing:** "Suggest tying spec approval → implementation handoff to a concrete artifact: "KEEP complete + `sweep.mjs` OPEN count for wait-family person-asks matches review expectations," so P1 doesn't start with 622 kept hits still shifting."
- **Cursor · spec surface:** inventory numbers (2,156 / 289 / 3,749) are repeated across SPEC, DECISIONS, PLAN and README (hits vs lines drift risk); `post-to-mailbox` could be a one-off in P3 rather than a permanent rule family (7 hits).
- **Cursor · performance:** "If CI ever adopts this, prefer `--only` / changed-files on PRs and fail-fast mode before optimizing the engine." The full scan takes about a second today.
