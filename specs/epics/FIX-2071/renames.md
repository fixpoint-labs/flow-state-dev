# FIX-2071 · The rename table

[Spec](SPEC.md) · [Decisions](DECISIONS.md)

One row per retired name in package source, with the name that replaces it and the child that
lands it. This table is the contract for every child except FIX-2183, whose names its own spec
decides ([D2](DECISIONS.md#d2)). A child renames its rows in one PR, from a committed codemod
under `scripts/codemod/`, and adds each row's identifiers to `RETIRED` in
`goals/vocabulary/one-word-per-thing/rules.mjs` in the same PR ([ER-2](DECISIONS.md#who-owns-what)).
No alias, no re-export under the old name, no second spelling read ([D1](DECISIONS.md#d1)).

The **head name** is decided here. A **derived spelling** (a factory, a file, a test id, a type
parameter) follows its head name the way the old one followed the old head, and is the child's
call. A derived spelling that would collide with a live name elsewhere stops the child: it comments
up, and the fix is an amendment to this table.

Counts are `git grep -lw` on `main` at adc3219, package source / docs and READMEs / the rest
(tests, apps, goals, labs), `CHANGELOG.md` files left out. They size the work; the sweep, not the
count, is the check.

## Owned here

| Retired | Becomes | Kept on purpose | Owner | Files |
|---|---|---|---|---|
| `TaskCollection.addTask`, a board capability's `addTask` | `createTask`, the filer tool's name | The engine's side-chain pool `addTask` (`core/src/execution/request-side-chain-pool.ts`): a promise pool, not a task. The codemod is type-aware so it leaves it | FIX-2243 | 130 / 24 / 20 |
| `readTask` | `getTask` | — | FIX-2243 | 2 / 3 / 5 |
| `cancelTask` | `updateTask({ status: "cancelled" })` | — | FIX-2243 | 1 / 6 / 5 |
| `dispatchTask`, `assignTask`, `failTask`, `blockTask`, `completeTask`, `answerTask*`; `parkOnQuestion`, `parkedOnQuestion`, `awaitReview`, `unparkAndDrain`, `onReview`, harness-manager's `answerQuestion()` (removed by FIX-2056 and FIX-2058) | Nothing new: the line goes | A migration note or a refusal test, marked `retired-name-refusal`. A live helper that answers a question hold (`task-tools-capability.ts`) is not the harness's, and goes in the sweep's keep list with that reason | FIX-2243 | 8 / 4 / 18 at most |
| `chief-of-staff` (worker id) | `shift-coordinator`. The old id stops working | — | FIX-2244 | 29 / 10 / 49 |
| `chiefOfStaff*`, `ChiefOfStaff*` | `shiftCoordinator*`, `ShiftCoordinator*` | — | FIX-2244 | 17 / 2 / 5 |
| Shift Manager's `cos` route and test ids | `shift-coordinator` | — | FIX-2244 | — |
| `TaskDispatcher` | `ClaimOrder` | — | FIX-2245 | 16 / 4 / 0 |
| `priorityDispatcher`, `topologicalDispatcher`, `runOwnerDispatcher`; `tasks/dispatchers/` | `priorityClaimOrder`, `topologicalClaimOrder`, `runOwnerClaimOrder`; `tasks/claim-orders/` | `fifoDispatcher` is FIX-2072's: removed there, or renamed `fifoClaimOrder` here if it stays | FIX-2245 | — |
| `FlowDispatcher`, `InProcessDispatcher` | `FlowRunner`, `InProcessRunner` | The dispatcher block (`core/src/blocks/dispatcher.ts`), dispatching a task, and `dispatch` | FIX-2245 | 22 / 4 / 0 |
| `onDelegatedPost`, `isPostRow`, `onPostSettled`, `postCancelled` | `onRoutedTask`, `isRoutedTask`, `onRoutedTaskSettled`, `routedTaskCancelled` | — | FIX-2246 | 3 / 2 / 4 |
| `postId`, `RoundPost` | `taskId`, `RoundTask` | — | FIX-2246 | 21 / 4 / 10 |
| `reopen*` | `followUp*` | — | FIX-2246 | 34 / 29 / 41, case-insensitive |
| `runTaskBoard`, `RUN_BOARD_ENTRY` | `dispatch`, `DISPATCH_ENTRY` | — | FIX-2246 | 10 / 3 / 4 |
| `retryOf`, `RETRY_OF` | `attemptOf`, `ATTEMPT_OF` | — | FIX-2246 | 9 / 4 / 1 |
| `delegationBoard`, `settleSplitTask`, `cancelSplitPieces` left over | Nothing new: the line goes | — | FIX-2246 | 1 / 2 / 1 |
| `fsd.ask.*` run-once keys; a notice's `asked` flag; a wait gate's stored reason `"ask"` | `fsd.wait.*`; `waited`; `"wait"`, with no second spelling read | — | FIX-2246 | 0 / 0 / 1; 1 source file |
| `<board>-hand-off-<assignee>`, `<board>-hand-off-fallback` | `<board>-dispatch-<assignee>`, `<board>-dispatch-fallback` | — | FIX-2246 | 1 / 0 / 1 |
| Kit (filing kit, session kit) and a `kit` variable | Factory | — | FIX-2246 | 8 / 4 / 9 |
| A `run` action left on a Workforce worker flow | `respond`, the door the worker contract requires | A flow outside Workforce keeps its own action names ([D3](DECISIONS.md#d3)) | FIX-2246 | — |
| Seat, mailbox in goal names | Worker, coordinator | Verdict logs and dated run records | FIX-2248 | 17 goal names |
| `"human_approval"`, `"human_input"` | `"user_approval"`, `"user_input"` | — | FIX-2151 | ~138 |

## Owned by FIX-2070, swept here

FIX-2070 removes these outright as it builds their replacements, with no alias
([FIX-2070's ER-7](https://github.com/fixpoint-labs/flow-state-dev/pull/3983), [D4](DECISIONS.md#d4)). The closure,
FIX-2249, puts them in `RETIRED`; one still in package source then is FIX-2246's to remove.

| Retired | Becomes | Files |
|---|---|---|
| `onWorkerMessage` | `receive` | 9 / 2 / 0 |
| `messageWorker` | `sendMessage` | 12 / 5 / 6 |
| `workforceRelayTo` | Nothing: no relay | 1 / 2 / 0 |
| `replyTo` | `inReplyTo` | 10 / 3 / 2 |
| The `takes_tasks_only` and `no_turn` refusals | Nothing: anyone on the roster | — |

The message door (`parkedForTurn`, `messageDoor`, `harnessMessageDoor`) is not FIX-2070's. It is
gone from package source but for harness-manager's upgrade note, so it is FIX-2246's: mark the
note, add the names to `RETIRED`.

## Decided by FIX-2183

The four meanings of *hold* on the task surface, and `updateTask`'s `question` field
([the project spec](https://github.com/fixpoint-labs/flow-state-dev/pull/3102), *Decided since the
last refresh*). FIX-2183's spec adds its rows to this table before it builds.
