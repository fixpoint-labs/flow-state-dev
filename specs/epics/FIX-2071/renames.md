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
| `TaskCollection.addTask`, a board capability's `addTask` | `createTask`, the filer tool's name. One name for one act: the tool's input is the method's `TaskInit` as a model sees it, so the two keep one contract and the tool calls the method | The engine's side-chain pool `addTask` (`core/src/execution/request-side-chain-pool.ts`): a promise pool, not a task. The codemod is type-aware so it leaves it | FIX-2243 | 130 / 24 / 20 |
| `readTask` | `getTask` | — | FIX-2243 | 2 / 3 / 5 |
| `cancelTask` | `updateTask({ status: "cancelled" })` | — | FIX-2243 | 1 / 6 / 5 |
| `dispatchTask`, `assignTask`, `failTask`, `blockTask`, `completeTask`, `answerTask*`; `parkOnQuestion`, `parkedOnQuestion`, `awaitReview`, `unparkAndDrain`, `onReview`, harness-manager's `answerQuestion()` (removed by FIX-2056 and FIX-2058) | Nothing new: the line goes | A migration note or a refusal test, marked `retired-name-refusal`. A live helper that answers a question hold (`task-tools-capability.ts`) is not the harness's, and goes in the sweep's keep list with that reason | FIX-2243 | 8 / 4 / 18 at most |
| `chief-of-staff` (worker id) | `shift-coordinator`. The old id stops working | — | FIX-2244 | 29 / 10 / 49 |
| `chiefOfStaff*`, `ChiefOfStaff*` | `shiftCoordinator*`, `ShiftCoordinator*` | — | FIX-2244 | 17 / 2 / 5 |
| Shift Manager's `cos` route and test ids | `shift-coordinator` | — | FIX-2244 | — |
| `TaskDispatcher` | `ClaimOrder` | — | FIX-2245 | 16 / 4 / 0 |
| `priorityDispatcher`, `topologicalDispatcher`, `runOwnerDispatcher`; `tasks/dispatchers/` | `priorityClaimOrder`, `topologicalClaimOrder`, `runOwnerClaimOrder`; `tasks/claim-orders/`, moved with `git mv` in the same PR so history follows | `fifoDispatcher` is FIX-2072's: removed there, or renamed `fifoClaimOrder` here if it stays | FIX-2245 | — |
| `FlowDispatcher`, `InProcessDispatcher` | `FlowRunner`, `InProcessRunner` | The dispatcher block (`core/src/blocks/dispatcher.ts`), dispatching a task, and `dispatch` | FIX-2245 | 22 / 4 / 0 |
| `onDelegatedPost`, `isPostRow`, `onPostSettled`, `postCancelled` | `onRoutedTask`, `isRoutedTask`, `onRoutedTaskSettled`, `routedTaskCancelled` | — | FIX-2246 | 3 / 2 / 4 |
| `RoundPost` | `RoundTask` | — | FIX-2246 | 3 / 2 / 0 |
| `postId` | **Not decided here: a known collision.** `taskId` is already live beside it (`coordinator-flow.ts`'s `routedTaskId(postId, …)`). FIX-2246 reads whether the two ids are one, and adds the head name as an amendment row before it builds | — | FIX-2246 | 21 / 4 / 10 |
| `legacyPostRowId` (`workforce/src/coordinator/coordinator-flow.ts`), a reader of the old post row id | Nothing: deleted, stores are reset ([D1](DECISIONS.md#d1)) | — | FIX-2246 | 1 / 0 / 0 |
| A task *reopen*: the `reopened` retired shape (`tasks/schema/retired-shapes.ts`) and any task reopen still taught in docs | Nothing new: the follow-up already has its name (`followUpOf`). The shape stays on its `retired-name-refusal` lines; the docs say follow-up. `RETIRED` matches these exact identifiers, never a `reopen` prefix | Every other reopen: the Inbox check's `reopened` (a closed hold seen again), a stream or connection reopen, a reopened workstream, and prose | FIX-2246 | listed by FIX-2246 |
| `runTaskBoard` left in `engine/src/stores/testing/wake-store-conformance.ts` (the rename to `dispatch` and `DISPATCH_ENTRY` is done) | `dispatch` | — | FIX-2246 | 1 / 0 / 0 |
| `upgradeWorkerEntryNames` and its types (`workforce/src/workers/upgrade-entry-names.ts`), the reader that rewrites stored old entry names (`runTaskBoard`, the `run` and `message` doors) at host start, and its call in kitchen-sink's `stored-work-upgrade.ts` | Nothing: removed, since no stored old name is left to rewrite ([D1](DECISIONS.md#d1)) | — | FIX-2246 | 2 / 1 / 1 |
| Workforce's `RETRY_OF` (`conversation-board/board-entries.ts`; nothing writes it since FIX-2077) | Nothing: deleted | The engine's request `retryOf`: a request the `/retry` route re-ran, kept in request metadata (`engine/src/execution/request-recovery.ts`, `past-turns.ts`, `routes/recovery-routes.ts`). Not a task attempt | FIX-2246 | 2 / 0 / 0 |
| `hireWorkforce`'s `messages.hopLimit` | `messages.budget`: since FIX-2238 it caps the one budget per message a user types ([FIX-2070's ER-6](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-2070/DECISIONS.md)), not a hop count. Derived spellings follow (`DEFAULT_MESSAGE_HOP_LIMIT`, the `hop_limit` refusal) | `messages.perTurn`: still the most one request sends, and a turn is that request's name for a person | FIX-2246 | 5 / 1 / — |
| `delegationBoard`, `settleSplitTask`, `cancelSplitPieces` left over | Nothing new: the line goes | — | FIX-2246 | 1 / 2 / 1 |
| `fsd.ask.*` run-once keys; a notice's `asked` flag; the wait-gate id prefix `ask:` (`orchestration/src/tasks/helpers/wait-on-task.ts`, `engine/src/context/wait-resume-operation.ts`); the two readers `.changeset/wait-vocabulary.md` names (a gate stored with reason `"ask"` read as a wait, a row's `ask` read as `wait`) | `fsd.wait.*`; `waitedOn`, the word `listTasks` already uses; `wait:`; the readers deleted, with no second spelling read | — | FIX-2246 | 2 source files, plus the readers |
| `<board>-hand-off-<assignee>`, `<board>-hand-off-fallback`; a reader of the `"handed-off"` termination reason `.changeset/dispatch-vocabulary.md` names, if one is left | `<board>-dispatch-<assignee>`, `<board>-dispatch-fallback`; the reader deleted | — | FIX-2246 | 1 / 0 / 1 |
| Kit (filing kit, session kit) and a `kit` variable | Factory | — | FIX-2246 | 8 / 4 / 9 |
| A `run` action left on a Workforce worker flow | `respond`, the door the worker contract requires | A flow outside Workforce keeps its own action names ([D3](DECISIONS.md#d3)) | FIX-2246 | — |
| Seat, mailbox in goal names | Worker, coordinator | Verdict logs and dated run records | FIX-2248 | 17 goal names |
| `"human_approval"`, `"human_input"` | `"user_approval"`, `"user_input"`. `SuspensionReason`'s open `string & {}` arm means a missed call site still compiles and silently becomes a custom reason (no Inbox item), so FIX-2151 adds both exact strings to `RETIRED` in its own PR | — | FIX-2151 | ~138 |

## Owned by FIX-2070, swept here

FIX-2070 removes these outright as it builds their replacements, with no alias
([FIX-2070's ER-7](https://github.com/fixpoint-labs/flow-state-dev/pull/3983), [D4](DECISIONS.md#d4)). FIX-2070's closure,
FIX-2242, puts every name in this section in `RETIRED` ([#4024](https://github.com/fixpoint-labs/flow-state-dev/pull/4024), its D2: rows `message-names` and `message-reply-to`), so FIX-2249 sweeps only the rows above, and one still in package source then is FIX-2246's to remove.

| Retired | Becomes | Files |
|---|---|---|
| `onWorkerMessage` | `onMessageReceived`, named `on` plus the event like `onTaskSettled` (derived: `messageReceivedEntry`, `MESSAGE_RECEIVED_ENTRY`) | 9 / 2 / 0 |
| `messageWorker` | `sendMessage` | 12 / 5 / 6 |
| `workforceRelayTo` | Nothing: no relay | 1 / 2 / 0 |
| `replyTo` | `inReplyTo` | 10 / 3 / 2 |
| The `takes_tasks_only` and `no_turn` refusals | Nothing: anyone on the roster | — |
| `workerMessageEntry`, `takesWorkerMessages`, `sendWorkerMessage`, `SendWorkerMessage`, `messageWorkerInputSchema`, `workerMessageInputSchema` (FIX-2238) | Nothing: the entry and tool above replace them | — |
| `MESSAGE_WORKER_TOOL`, `WORKER_MESSAGE_ENTRY`, `answerTo` | Nothing: the entry, the tool and `inReplyTo` above replace them | — |
| `WORKER_MESSAGES_SEEN_STATE` (FIX-2240) | Nothing: delivery once replaces the seen window | — |

The entry was first specced as `receive` (#3983); the owner renamed it `onMessageReceived` on 2026-10-27. FIX-2238 (#3986) builds it under the new name and amends FIX-2070's merged spec, figures and the coordination design docs. FIX-2242 puts `receiveProblem`, `receiveEntry` and `RECEIVE_ENTRY` in `RETIRED`, never a bare `receive`, which is an ordinary verb and a live identifier elsewhere.

The message door (`parkedForTurn`, `messageDoor`, `harnessMessageDoor`) is not FIX-2070's. It is
gone from package source but for harness-manager's upgrade note, so it is FIX-2246's: mark the
note, add the names to `RETIRED`.

## Decided by FIX-2183

The four meanings of *hold* on the task surface, FIX-2092's held phase steps, *waiting* (a task
waiting on a user and FIX-2214's status; FIX-2070's `onMessageReceived` field is `call`, so it is not one), and `updateTask`'s `question` field
([the project spec](https://github.com/fixpoint-labs/flow-state-dev/pull/3102), *Decided since the
last refresh*). FIX-2239's message row says `queuedBehind`, not `heldBy`, so a queued message is not one of them.
Decided in [FIX-2183's spec](../../issues/FIX-2183/SPEC.md): *hold* keeps one meaning, the filer's
hold before a start; a task's open asks are `questions`; what keeps a running task open is
`keptOpenBy`. Counts are on `main` at 78b0b07, re-derived by its
[`poc/inventory/check.mjs`](../../issues/FIX-2183/poc/inventory/check.mjs).

| Retired | Becomes | Kept on purpose | Owner | Files |
|---|---|---|---|---|
| `Task.holds`, an Inbox item's `holds` | `questions` | — | FIX-2183 | read, not counted: up to 113 files name a `holds` field |
| `TaskHold`, `taskHoldSchema`, `RowHold`, `rowHoldSchema`, `SuspensionHold`, `suspensionHoldSchema`, `RowHoldSource`, `SuspensionHoldSource`, `InboxHold` | `TaskQuestion`, `taskQuestionSchema`, `RowQuestion`, `rowQuestionSchema`, `SuspensionQuestion`, `suspensionQuestionSchema`, `RowQuestionSource`, `SuspensionQuestionSource`, `InboxQuestion` | — | FIX-2183 | 17 / 1 / 6 |
| `HoldAsk`, `HoldReleaser` (and `source.releasedBy`), `HoldAnswer`, `MAX_HOLD_PROMPT` | `QuestionInit`, `QuestionCloser` (`source.closedBy`), `QuestionAnswer`, `MAX_QUESTION_PROMPT` | A question's `ask` field: the sweep's kept meaning, a question to a user | FIX-2183 | 9 / 0 / 2 |
| `openHolds`, `hasOpenHold`, `openRowHolds`, `isRowHold`, `isSuspensionHold`, `suspensionHoldOf`, `holdsDue`, `nextHoldDue`, `newRowHolds`, `holdWrite`, `HoldChange`, `HoldWriteResult`, `payHoldDeadlines`, `holdDueMs`, `holdOfSuspension`, `openUserHolds` | The same with *question* for *hold*: `openQuestions`, `hasOpenQuestion`, `openRowQuestions`, `isRowQuestion`, `isSuspensionQuestion`, `suspensionQuestionOf`, `questionsDue`, `nextQuestionDue`, `newRowQuestions`, `questionWrite`, `QuestionChange`, `QuestionWriteResult`, `payQuestionDeadlines`, `questionDueMs`, `questionOfSuspension`, `openUserQuestions` | — | FIX-2183 | 21 / 2 / 26 |
| The write outcomes `"held"` (a question is open) and `"no-such-hold"`; the options `whileHoldOpen`, `refuseWhenHeld` | `"open-question"`, `"no-such-question"`; `whileQuestionOpen`, `refuseWithOpenQuestion` | The status decline `held → errored`, which is the filer's hold | FIX-2183 | 6 / 1 / 1, and the readers of `"held"` |
| The Inbox client's `answerHold`; task-tools' live `answerQuestion` helper | `answer`; `answerTaskQuestion`, which ends FIX-2243's keep entry for it | — | FIX-2183 | 5 / 1 / 3 |
| `updateTask`'s `question` input (tool and action); its `done_without_question` refusal | `answers`, the field the steer stores (`TaskSteer.answers`); `done_without_answers` | The `no_such_question` refusal, already a question's word | FIX-2183 | read, not counted: a field name |
| `Task.waitingOn`, `TaskWaitingOn`, `setWaitingOn` | `keptOpenBy`, `TaskKeptOpenBy`, `setKeptOpenBy`; values `wait`, `filed`, `steer` unchanged, and the `queued` read moves with it | `Task.wait` (the wait slot), `wait_changed`, `waitOnTask`: a request waiting on a task | FIX-2183 | 19 / 5 / 35 |
| `endRules.filedWorkHolds`, the helpers `filedWorkHolds` and `holdsItsFiler` | `filedWorkKeepsOpen`, `keepsFilerOpen` | — | FIX-2183 | 4 / 2 / 1 |
| `heldTask`, `heldTaskId`, `heldRowOf`, `ticketHoldsRow` (a request holding a task) | `claimedTask`, `claimedTaskId`, `claimedRowOf`, `ticketClaimsRow` | — | FIX-2183 | 5 / 0 / 2 |
| Shift Manager's `holderSessionId`, `holderOf` (the session that holds a board) | `ownerSessionId`, `boardOwnerOf` | — | FIX-2183 | 4 / 0 / 3 |
| `goals/task-board/holds-a-task-on-questions` | `goals/task-board/waits-on-its-questions` | Its verdict log | FIX-2183 | 1 goal |
| Prose on published pages: "held on (a, its) question(s)", "a question holds its task", "row hold", "suspension hold", "open holds" | "waits on its questions", "waiting on a user", "question" | Status `held`, `held: true`, `hold()`, `release()`, the `held` and `released` change kinds, `counts.held`, `heldFromBlocked`, FIX-2092's held phase steps; a checkout's held work; hold as an English verb | FIX-2183 | the prose row in `RETIRED` |
