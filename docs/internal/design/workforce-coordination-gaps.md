# Workforce Coordination: Gaps to Today

This is the refactor material for
[Workforce Coordination: How It Should Work](workforce-coordination-concept.md). The concept doc is
the model; this file is the backlog that feeds FIX-2056's sub-issues: what the model replaces, the
terms it retires, and where today's code differs, phase by phase. It is kept apart from the model on
purpose, so the model stays readable.

## What changes

| | |
| -- | -- |
| Lost | Settling any task by hand. The blocked status. Stopping for a person on a host without durable execution. Reporting every failure automatically |
| Narrowed | Tasks only to delegates (or `delegates: all`). Workers changing their own delegates. A split's `{ answer, pieces }` result |
| Changed | A wait's deadline doesn't cancel the task. A person's answer resumes the suspended request instead of starting a new one. Deadlines are the flow's to handle. No automatic reply to messages. Every coordinator can be messaged. Boards differ by `mode`, plan or delegation, and never mix. A worker's plan is a plan board. A dispatcher can wait. A goal-seek loop needs a plan board. A task can be held on questions, asked before it starts. Dependencies stay within one board. A worker declares roles, and the hire checks their entries. The durability sweeper pays what a board owes. Recurring work is a schedule that files a task. `dispatch` runs one at a time. The task tools are the public task actions |
| Kept | Patterns, which are plan boards already. Who settles a row: the drain for an inline row (`orchestration/src/task-board/index.ts`, header), the claim gate for a dispatched one (`orchestration/src/task-board/blocks/dispatch-row.ts`, header), never the worker block. Pluggable claim orders. A delegate's memory across routed tasks. Routing, rounds and records. A coding run resuming its coding session, after a question or a steer (`harness-manager/src/door.ts:15-20`) |

## Retired terms the refactor removes

Files mentioning each term on 2026-10-17, the last four rows 2026-10-19 (`git grep -l`): package source / docs (docs site,
`docs/architecture`, READMEs) / the rest (tests, apps, goals, labs). Reopen, answer a task and chief
of staff have many spellings, so they count case-insensitive substrings (`-i`). Other rows count
the listed identifiers as whole words (`-w`). Kit counts the lowercase whole word, leaving out four
unrelated hits (a design-system goal, and three tests naming a package `kit`).

| Retired | Say | In code | Files |
| -- | -- | -- | -- |
| Post | Routed task | `onDelegatedPost`, `isPostRow`, `onPostSettled`, `postCancelled`; `postId`, `RoundPost` | 7 / 1 / 17; 6 / 2 / 21, 2 / 0 / 1 |
| Message entry; tool | `receive`; `sendMessage` | `onWorkerMessage`; `messageWorker` | 5 / 1 / 2; 7 / 4 / 5 |
| Park on a question; review park; a coding run's question inbox | Inbox item | `parkOnQuestion`, `parkedOnQuestion`; `awaitReview`, `unparkAndDrain`, `onReview`; `answerQuestion` | 8 / 4 / 15; 19 / 6 / 42; 2 / 3 / 5 |
| Message door | Steer | `parkedForTurn`, `messageDoor`, `harnessMessageDoor` | 9 / 2 / 5 |
| Reopen | Follow-up | `reopen*` | 26 / 12 / 56 |
| Answer a task | Answer the Inbox item | `answerTask*` | 3 / 6 / 23 |
| Relay; reply | None; `inReplyTo` | `workforceRelayTo`; `replyTo` | 1 / 0 / 0; 5 / 2 / 6 |
| Blocked | Cancel, or a dependency | `blockTask` | 2 / 2 / 12 |
| Removed task tools | `addTask`, `updateTask` | `dispatchTask`; `assignTask`; `failTask` | 14 / 9 / 62; 3 / 4 / 23; 2 / 2 / 13 |
| Split settle; split cancel; piece retry | A running task; cancel; attempts | `settleSplitTask`; `cancelSplitPieces`; `retryOf` | 1 / 0 / 0; 1 / 0 / 0; 6 / 0 / 5 |
| Own-state board | None, pruned | `delegationBoard` | 1 / 0 / 0 |
| Chief of staff | Shift Coordinator | `chief-of-staff`, `chiefOfStaff*`, prose | 23 / 8 / 101 |
| Dispatcher (one word for four things; the dispatcher block, dispatching a task and `dispatch` keep it) | Claim order; runner | `TaskDispatcher`; `FlowDispatcher` | 13 / 1 / 6; 11 / 2 / 10 |
| Self-assigned row | Plan row | `completeTask` | 2 / 3 / 14 |
| Kit (filing kit, session kit) | Factory | prose, and a `kit` variable | 8 / 4 / 9 |
| The `run` action | Respond | `"run"`, every flow's (an upper bound) | 26 / 21 / 364 |
| Run the task board | Dispatch | `runTaskBoard`; `RUN_BOARD_ENTRY` | 1 / 0 / 9; 6 / 0 / 0 |

## Where today's code differs

Paths are relative to `packages/`. Each phase is one epic. Phase 0 blocks nothing; 2 needs 1; 3
needs 1 and 2; 4 runs beside 2 and 3; 5 goes last. Phase 2 also needs two fixes that apply to every
suspension, not only these: a resume taking its turn in the session (FIX-2062), and durable
execution by default on file-backed hosts (FIX-2063). Replay of a request suspended across a
deploy is a known risk, deferred.

| Phase | Target | Today |
| -- | -- | -- |
| 0 · Land | A request reads its own claim only | Fixed on the FIX-1047 branch, not on main (`orchestration/src/task-board/flow-policy-wiring.ts`) |
| 0 · Prune | Nothing the repo doesn't use, with its README and docs entries | Unused in the repo: `dispatchAndExecuteBlock` (`orchestration/src/tasks/helpers/dispatch-and-execute.ts`), the classifier and event claim orders, and fifo, a copy of the default (`orchestration/src/tasks/dispatchers/`). The own-state board has no production user (`orchestration/src/skills/task-tools-capability.ts:122`). Drain Pool is docs only (`apps/docs/docs/patterns/overview.md:69`) |
| 1 · One task | Routed tasks; attempts a setting | Posts have their own row kind and entries (`workforce/src/coordinator/delegated-post.ts`). Rounds, their deadlines, `routeOn` and settlement key on `postId` (`workforce/src/coordinator/coordinator-rounds.ts`, `coordinator-state.ts`, `coordinator-flow.ts`), so they move with it. Attempts are 2 for tasks (`workforce/src/conversation-board/board.ts:118`), 1 for posts |
| 1 · One task | `onTaskSettled` in orchestration, every ending delivered | Workforce owns it (`workforce/src/conversation-board/task-settled.ts`). A cancel owes a notice only when a request waits on the task (`orchestration/src/tasks/notice/task-notice.ts:100-102`) |
| 1 · One task | A failure is an ending delivered to the filer; Error Reporter hears only what a filer messages it | Two automatic routes, neither through the filer. The engine's `errorCapture` hands the reporter every request that settles failed (`workforce/src/error-reporter/reporter.ts:315-320`, wired at `shift-manager/teams/devteam/host.mts:1194`), holding one in a task's session for the task's ending (`reporter.ts:212-221`). Every errored ending marks its row owed a report (`workforce/src/conversation-board/ledger.ts:106`, `report-owed.ts:34-38`), sent to the reporter's intake on every touch, board run, task entry and post ending (`board.ts:592`, `:631`, `task-entry.ts:313`, `coordinator/delegated-post.ts:421-422`) |
| 1 · One task | Every debt a row owes carries a due time, and the durability sweeper wakes at the earliest one and pays it | Nothing sweeps these debts. The board's own comment: "nothing sweeps for it: this touch is what pays it" (`workforce/src/conversation-board/board.ts:583-587`). The sweeper's default interval is 10 minutes (`engine/src/durability/durability-sweeper.ts:141`), and it already wakes early at the earliest wait deadline (`:46`) |
| 1 · One task | A plan board and a delegation board, told apart by `mode`; a board that mixes them is refused when built | No plan: one board per session, with no inline workers, dispatching every row (`workforce/src/conversation-board/board.ts:415-425`). The agent worker's `run` is skill matching then one generator, wrapped by `work` (`workforce/src/agent-worker-flow.ts:1190-1206`, `:1296-1360`). Patterns drain boards inline (`patterns/src/plan-and-execute/index.ts:716-724`, `parallelTasks/index.ts:127-135`, `supervisor/index.ts:370-378`). The assignee kind, not a setting, decides whether a drain waits (`orchestration/src/task-board/quiescence.ts`, header) |
| 1 · One task | A plan board waits on a row it dispatched, which the child's claim gate settles; the dispatcher has `wait`, `false` by default | A drain never waits on a dispatched row (`orchestration/src/task-board/blocks/dispatch-row.ts`, header); a dispatcher never waits for a result (`core/src/blocks/dispatcher.ts:170`) |
| 1 · One task | A goal-seek loop needs a plan board, and refuses a delegation board when built | `goalSeekLoop` doesn't check its board's assignees; its construction checks cover only `maxIterations`, the board's backing and idless seeds (`orchestration/src/task-board/goal-seek-loop.ts`, header). Over a board that dispatches without waiting, the judge rules while rows are still in flight, and `continue` re-drains, exits at once and spends iterations up to `maxIterations`. A latent bug: nothing in the repo runs it that way |
| 1 · One task | An ending that makes a row startable runs `dispatch` | Only a retry runs the board; other endings wake the filer's turn or land as a line (`orchestration/src/tasks/notice/task-notice.ts:196-198`). A dependent starts on the next touch (`board.ts:578-589`) |
| 1 · One task | `respond`; `dispatch` | `run` (`agent-worker-flow.ts:1322`); `runTaskBoard` (`workforce/src/conversation-board/board-entries.ts:8`), the drain then `afterRun`'s resends (`board.ts:614-643`) |
| 1 · One task | `dispatch` runs one at a time per session; a second call is rejected | `runTaskBoard`'s entry declares no `concurrency` (`workforce/src/conversation-board/session-board.ts:190`), so it falls back to `"allow"` (`core/src/types/flow.ts:417-420`) and duplicate drains run side by side |
| 1 · One task | The drain's last startable check runs after its repairs, so nothing runs between it and the exit; the sweeper pays any row startable later | The repairs run after the drain: `runTaskBoard` is the drain, then `afterRun` (`workforce/src/conversation-board/board.ts:641-643`), which resumes owed waits, resends notices and owed reports, and settles splits (`board.ts:614-638`) |
| 1 · One task | A task's request may wait on a task it filed, up to 5 waits deep | Every task request is refused a wait (`orchestration/src/tasks/helpers/wait-for-response.ts:222-230`) |
| 1 · One task | A wait's deadline leaves the task running | It cancels the row (`orchestration/src/tasks/helpers/wait-for-response.ts`) |
| 1 · One task | Splits use delegates and stay running | Pieces go to any roster worker (`board.ts:280-296`). The parent parks until `settleSplitTask` (`workforce/src/conversation-board/split.ts`) |
| 1 · One task | Delegates are authority; `all` | Any worker with delegates can change them (`workforce/src/delegates/worker-delegates.ts`). No `all` |
| 1 · One task | One open task per session; another stays pending | A follow-up into a busy session is refused, not queued (`session_has_unfinished_task`, `orchestration/src/skills/task-tools-capability.ts:656-662`) |
| 1 · One task | Start: now, after named tasks, or held until `updateTask` | No held start. A filed task can be moved to `blocked` (`orchestration/src/tasks/schema/task-status.ts:15`), and `unblock` has no caller |
| 1 · One task | Recurring work is a schedule that files an ordinary task when it fires; a user's list of scheduled work reads their schedule collection and each schedule's next fire time | Nothing files a task from a schedule: no Workforce package depends on `@flow-state-dev/scheduled` (the `package.json` of `workforce`, `orchestration`, `harness-manager` and `shift-manager`). A schedule's row has no next fire time (`scheduled/src/defineScheduleCollection.ts:39-62`); `nextFireAt` is on the schedule index's row (`scheduled/src/scheduleIndex.ts:58`), kept only when the host configures an index (`defineScheduleCollection.ts:73-79`). The two limits stand: at most once, so a dispatch that fails after its row advanced is dropped (`scheduleIndex.ts:14-17`), and a durable dynamic schedule doesn't recover across a crash (`scheduled/README.md:125`) |
| 1 · One task | A dependency stays within one board; crossing boards is a wait or a held task | A dependency is a bare task id looked up in the same collection only, and an id from another board never resolves, so the row stays pending for good (`orchestration/src/tasks/collection/internal.ts:742-750`, `:823-829`) |
| 1 · One task | Cancelling, retrying or failing a task cancels its open tasks | Only cancelling a split task cascades to its pieces (`workforce/src/conversation-board/split.ts:341-361`) |
| 1 · One task | A failed or cancelled dependency cancels its dependents | A dependent waits for a `completed` dependency (`orchestration/src/tasks/collection/internal.ts:742-750`), and one that will never complete leaves it pending for good (`orchestration/src/task-board/blocks/board-meta.ts:245-274`) |
| 1 · One task | Seven tools; one fit call | Twelve task tools (`orchestration/src/skills/task-tools-capability.ts`) plus `messageWorker`. `unblock` has no caller (`orchestration/src/tasks/collection/state-backed.ts:695`). Two fit calls: best fit picks (`workforce/src/best-fit.ts`), lead fit only vets (`workforce/src/projects/lead-fit.ts`) |
| 1 · One task | The task tools are public actions a screen calls as the user: cancel a task, start a held one, answer its questions | Eleven `<tool>_tasks` actions (`workforce/src/conversation-board/session-board.ts:13-16`, `board.ts:735-736`): the target's five task tools plus `assignTask`, `completeTask`, `failTask`, `blockTask`, `answerTask` and `dispatchTask` (`orchestration/src/skills/task-tools-capability.ts:1754-1757`) |
| 1 · One task | A worker declares its roles; the hire checks each role's entries exist and accept their inputs, by probing their input schemas. `receive` joins the check in phase 4 | The contract checks only configuration, one door and attribution (`workforce/src/worker-flow-contract.ts:1-25`). The task, message and board entries arrive through factories a flow opts into (`workforce/src/conversation-board/session-board.ts:1-30`) |
| 2 · One Inbox | Every stop for a person is one Inbox item, a suspension or a task held on questions, with one answer path | Suspensions sit beside three row parks: the question park, the review park and a coding run's question inbox. The Inbox shows only `human_approval` and `human_input` suspensions (`shift-manager/src/lib/reads.ts:327`). Answers go through a resume, `answerTask` or `unparkAndDrain` (`orchestration/src/task-board/park-exit.ts`). `answerQuestion()` has no screen (`harness-manager/src/inbox.ts:257`) |
| 2 · One Inbox | A task can be held on questions: they show in the Inbox at filing, each answer joins the brief, the last releases the hold, and its dependents wait too | No held start, and nothing can be asked before a task starts. The nearest thing is an `undispatched` row, recorded but not started (`orchestration/src/tasks/schema/task-init.ts:46-51`) |
| 2 · One Inbox | The claim gate marks a suspended task waiting on a person; it keeps its claim | On a suspend the gate only stops renewing the claim (`orchestration/src/task-board/task-entry.ts:533-537`), so the row lapses and another worker runs it again. Boards are told to park the task instead (`orchestration/src/task-board/index.ts:1101-1129`) |
| 2 · One Inbox | A deadline resumes the block with `deadline`, and the flow decides | Every suspension has an `expiresAt` (`core/src/types/suspension.ts:83`), but only an approval acts on it, always as an expired rejection (`engine/src/durability/stop-suspended.ts`). A wait on a task times out separately, after 30 seconds to an hour (`orchestration/src/tasks/helpers/wait-for-response.ts:212-221`) |
| 2 · One Inbox | Cancelling a task resolves its suspension with `cancelled` | Stopping a suspended request resolves a wait on a task so the parked call can carry on (`stop-suspended.ts`); nothing on the board resolves a person's suspension |
| 2 · One Inbox | Stopping a suspended request closes its Inbox item and cancels its task | A stop of a person's suspension ends the turn `aborted` (`engine/src/durability/stop-suspended.ts`, header); the board isn't told |
| 2 · One Inbox | The claim survives a resume | Untested. The claim is set by the worker's first step (`orchestration/src/task-board/flow-policy-wiring.ts`, on the FIX-1047 branch) |
| 2 · One Inbox | A coding run's question suspends the coding flow's request; the answer starts the next run in the same coding session | The row parks, and the answer starts a new attempt that resumes the coding session (`harness-manager/src/door.ts:15-20`, `ask.ts:24-29`) |
| 3 · Into a task | `updateTask` with a message, one rule by status | Reopen (`workforce/src/conversation-board/reopen.ts`), a coding run's door (`harness-manager/src/door.ts`), `answerTask` |
| 4 · Messages | A call awaits the result until its deadline, host-set by default; a late result is kept under its call id | Dispatch waits only for acceptance (`engine/src/context/dispatch-operation.ts`). `messageWorker` has no `wait` (`workforce/src/messages/message-tool.ts`). The one bounded wait, on a task, takes a timeout of 30 seconds to an hour (`orchestration/src/tasks/helpers/wait-for-response.ts:212-221`) |
| 4 · Messages | `receive`, no relay; anyone on the roster; the landing rules | `onWorkerMessage` relays the final text (`workforce/src/messages/worker-message-entry.ts`). `takes_tasks_only` and `no_turn` refusals (`workforce/src/messages/send-message.ts:107`). Every message lands in the recipient's conversation (`send-message.ts:228`) |
| 4 · Messages | A server-set budget per request; call ids; a call into a waiting session refused | The count lives in a guarded user-scope exchange row (`workforce/src/messages/hop.ts`), carried to tasks by filing (`board.ts:396`). Messages can't wait. No call ids |
| 5 · Words | One term, one thing | The retired-terms table |
