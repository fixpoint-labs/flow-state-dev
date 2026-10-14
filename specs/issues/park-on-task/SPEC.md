# Park on a task: a task turn waits on another task without blocking

**Spec** · [Decisions](DECISIONS.md) · epic FIX-1996 (Workforce: Shift Manager) · P1 FIX-1997 · P2 FIX-1999 · P3 FIX-1998

## Before and after

| Someone who… | Today | After |
|---|---|---|
| **is a worker on a task that needs another task's result** | Can dispatch the child, but can't wait for it. `dispatchAndWait` refuses a task turn ([`wait-for-response.ts:215`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/helpers/wait-for-response.ts#L215), FIX-1816 BR-5a). The child's ending wakes the coordinator, not this task | Dispatches the child, **parks its own row on it** and ends its request. When the child ends, the parent row is unparked and a new attempt starts with the child's `TaskNotice` as input |
| **is a coordinator** | Gets every child ending as a judgment turn, and has to relay the result by hand | Gets a line, not a judgment turn, for a child its parent parked on. The parent gets the notice ([D4](DECISIONS.md#d4)) |
| **is a task on one board that needs a task on another** | `deps` resolves only on its own board | Parks on the child on any board. `deps` stays same-board ([D3](DECISIONS.md#d3)) |
| **is Jake** | Most work runs as a task, so "a task can't wait" ends the road quickly | A task can wait, and no turn, lease or timer is held while it does |

Requested by Jake on 2026-10-14: *"we send and don't wait, but we also end the request if there isn't anything else we can do until the other task completes, and then wake on task completion (or failure) and start a new request as part of that wake."*

**Blocks:** the deferred task-turn wait from [#3365](https://github.com/fixpoint-labs/flow-state-dev/pull/3365) (FIX-1989 [DECISIONS D1](../FIX-1989/DECISIONS.md#d1), *"a task-turn wait is worth relaxing FIX-1816's one-deep rule, with a lease rule for the parked row, as its own issue"*). That follow-up waits on this spec, and this spec is its answer: it does not relax FIX-1816.

**Where it lives.** A standalone epic in the *Workforce: Shift Manager* project, not a follow-on to Orchestration Primitives ([#3102](https://github.com/fixpoint-labs/flow-state-dev/pull/3102)). It extends `dispatchTask` (FIX-1870), but the need is Workforce's (FIX-1989), so #3102's "anything after dispatchTask" line and its done-line don't move. Its exclusion of waiting on several tasks at once stands too: [D2](DECISIONS.md#d2) keeps one child per park.

## The goal, and how we'll know it's met

**A task turn can dispatch a child task on any board, park on it and end its request. The child's ending (completed, errored, cancelled, or parked on a question) starts the parent's next attempt with the child's notice as input, exactly once. Nothing blocks, no wait nests, and no timer sits on the parent.**

| Is it the right goal? | |
|---|---|
| **The real need** | Work that is all tasks can still depend on other work |
| **Smaller, and rejected** | "The coordinator relays the result." It already gets the ending, but it has to judge and refile, so a chain of N needs N coordinator turns |
| **Bigger, and rejected** | A blocking wait from a task turn (relaxing FIX-1816): a nested wait holds a row's lease open, can deadlock a chain and stacks timeouts |
| **Not done if** | The parent is resumed twice for one ending · a parent stays parked forever after its child ended, including a child that ended before the parent's park landed · a parked parent holds its board's drain open · the parent's lease or request is held while it is parked · the coordinator also gets a wake-turn for the same ending · a child on another board never unparks its parent · a parked parent has a timer of its own |

| How we verify | |
|---|---|
| **Goal check** | `goals/orchestration/park-on-task/` · `pnpm tsx goals/orchestration/park-on-task/run.mts`, each control as `GOAL_CONTROL=<name>` · real engine, real store, real model · run by the implementer · verdict in the implementation PR |
| **Signal** | **Leg 1:** task A's worker is told to get a fresh codename that only task B's worker (on a second board) can produce. A parks on B; A's row is `parked` with no lease and no running request while B runs; B completes; A's attempt 2 runs with B's notice and its output holds the codename. **Leg 2:** B errors; A's next attempt reads the error. **Leg 3:** the notice is replayed (restart between B's ending and A's resume); A runs attempt 2 once. **Leg 4:** the coordinator gets no wake-turn for B's ending; a line is expected ([D4](DECISIONS.md#d4)). **Leg 5:** B ends before A's park write lands; A still runs attempt 2, once. **Leg 6:** A is cancelled while parked; B is cancelled and A runs nothing more ([D1](DECISIONS.md#d1)). **Leg 7:** B fails with attempts left (`retried`); A stays parked. **Leg 8:** B parks on a question; A runs with it and answers B across boards ([D5](DECISIONS.md#d5)) |
| **Control that must fail** | `no-unpark` FAILS leg 1 (A stays parked) · `no-dedupe` FAILS leg 3 · `wake-coordinator` FAILS leg 4 · `park-blind` (the park write doesn't check the child) FAILS leg 5 · `unpark-on-retry` FAILS leg 7. Today's `main` FAILS leg 1: there is no park-on-task |

## What changes

1. **Park on a task.** A task turn calls `dispatchTask(target, { parkOn: true })` (name is the implementer's). It files the child **with `parkedBy: { boardId, taskId }` (the parent) already set**, then writes `parkedOn: { boardId, taskId }` (one ref, [D2](DECISIONS.md#d2)) on its own row and moves it `in_progress → parked` (allowed today, [`task-status.ts:89`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/schema/task-status.ts#L89)), with the reason `waiting on task <boardId>/<taskId>`. The turn ends; the lease (`leaseUntil`, [`task.ts:184`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/schema/task.ts#L184)) is cleared.
   - **No lost wake-up.** Filing and parking are two writes, so the child can end in between. The park write reads the child first: if it has already ended, the parent doesn't park, and its next attempt starts with the child's notice as it would after an unpark.
   - **One park encoding.** `parkedOn` is written and cleared by `parkPatch`/`unparkPatch`/`reopenPatch` beside `parkedForTurn` and `parkedOnQuestion`, not as a freestanding field each patch must remember.
   - **The drain doesn't wait on it.** A row parked on a task is excused from the board's waitable count whatever the board's park mode, so "ends its request" holds without `onReview: "exit"` and the drain doesn't spin to its budget on it (the FIX-1234 failure).
2. **The child's ending unparks the parent.** The child's ending goes through the existing ledger path: `recordEnding` ([`task-notice.ts:118`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/notice/task-notice.ts#L118)) marks it owed, `owedNotices` (:136) lists it, `decideNotice` (:195) picks the act. A new act, `unpark-parent`, sits beside `wake-turn`, `line` and `resume-wait` ([:180–192](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/notice/task-notice.ts#L180)), chosen when the notice carries `parkedBy`: `owedNotices` stamps it from the child row, the way it stamps `asked` for `resume-wait`. It moves the parent `parked → pending` ([`task-status.ts:91`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/schema/task-status.ts#L91)) with the notice as the next attempt's input, lands the coordinator's line ([D4](DECISIONS.md#d4)), and is cleared with `clearNotice` (:164).
   - **Exactly once.** The one fence is the unpark itself: the store's versioned write moves the parent `parked → pending` only while it is still `parked` and its `parkedOn` still names this child, and a version conflict re-runs it against fresh state, so a second send finds the parent already `pending` and does nothing. `noticeKey` ([:172](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/notice/task-notice.ts#L172)) is the replay dedupe the receiving entry already keeps for `resume-wait`, not a second fence.
   - **No retry spent.** The unpark bumps `turnReentries` as `unparkPatch` does for an answer, so a chain of N parks doesn't burn N of the parent's retries.
   - **Why not `resume-wait` with a row target.** `resume-wait` resumes a turn the request host holds suspended; a parked parent has no suspended turn, only a row to start again.
3. **Which endings.** `completed`, `errored`, `cancelled` unpark. `retried` does not (it is `run-board`, [:196](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/notice/task-notice.ts#L196)). `parked` with a question: [D5](DECISIONS.md#d5).

## What stays as it is

- **FIX-1816.** `dispatchAndWait` still refuses a task turn. No turn suspends, and the wait gate `waitGateId` ([`wait-for-response.ts:65`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/helpers/wait-for-response.ts#L65)) is not used.
- **`deps`** ([`task.ts:182`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/schema/task.ts#L182)) and its same-board lookup in `claim` ([`resource-backed.ts:640`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/collection/resource-backed.ts#L640), via `isClaimable`/`depsSatisfied`, [`internal.ts:862`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/collection/internal.ts#L862), :742).
- **A child nobody parked on** still wakes the coordinator, as today.

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| `isTaskTurn` ([`task-turn.ts:37`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/task-board/task-turn.ts#L37)) and its refusal ([`wait-for-response.ts:215`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/helpers/wait-for-response.ts#L215)) | **Kept.** The refusal message points to park-on-task instead |
| `NoticeEnding` incl. `cancelled` ([`task-notice.ts:48`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/notice/task-notice.ts#L48)), `TaskNotice` (:55) | **Reused** as the parent's next-attempt input |
| `decideNotice` and its acts ([`task-notice.ts:180–198`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/notice/task-notice.ts#L180)); Workforce's act enum ([`task-settled.ts:86`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/workforce/src/conversation-board/task-settled.ts#L86)) and caller (:257) | **Extended** with `unpark-parent` |
| `endingOf` / `applyEndingRecorder` ([`ending.ts:69`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/collection/ending.ts#L69), :107), opt-in per board via `recordEnding` ([`define-task-collection.ts:58`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/collection/define-task-collection.ts#L58)); today only the conversation ledger declares it ([`ledger.ts:101`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/workforce/src/conversation-board/ledger.ts#L101)), and delivery reads only that ledger ([`notice-delivery.ts:58`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/workforce/src/conversation-board/notice-delivery.ts#L58)) | **Needs prerequisite P1** so a child on any board records and delivers its ending |

### Prerequisite PRs

- **P1 · Endings on any board (FIX-1997).** A board that holds a parked-on child records endings (`recordEnding`) and has its owed notices delivered and replayed, not only `CONVERSATION_LEDGER_ID`. Delivery takes the board and address as parameters rather than a second copy of the loop, and replay is scoped so a worker board doesn't inherit the ledger's every-row-on-every-touch scan. Independent of D1–D5 ([`notice-delivery.ts:58`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/workforce/src/conversation-board/notice-delivery.ts#L58), [`board.ts:255`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/workforce/src/conversation-board/board.ts#L255)).
- **P2 · Parked-on fields (FIX-1999).** `parkedOn` (one ref) on the parent and `parkedBy` on the child in [`schema/task.ts`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/schema/task.ts), and `parkedBy` on `TaskNotice` next to `asked`. `markerFor` owes a notice for every ending of a `parkedBy` row, a `cancelled` one included (today it owes a cancel only for a waited-on row). The park write clears the lease and is excused from the drain's waitable count. Not on main.
- **P3 · Unpark with input (FIX-1998).** The `unpark-parent` act and a store write that moves `parked → pending` and carries the notice as the next attempt's input, with the `turnReentries` bump. The transition is allowed ([`task-status.ts:91`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/schema/task-status.ts#L91)) but there's no general unpark-with-input helper on main; the answer-to-question path (`feedback`, [`task.ts:136`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/schema/task.ts#L136)) is the pattern to copy.

| The debt | |
|---|---|
| **Adds** | One notice act, two row fields and one notice field, one park option on `dispatchTask`. Permanent |
| **Leaves** | Fan-out beyond one child ([D2](DECISIONS.md#d2)) · `deps` across boards ([D3](DECISIONS.md#d3)) |

## Sign off

**For Jake's merge:** [D1](DECISIONS.md#d1) cancelling a parked parent cancels the child · [D2](DECISIONS.md#d2) one child per park · [D3](DECISIONS.md#d3) `deps` stays same-board · [D4](DECISIONS.md#d4) the coordinator hears a line · [D5](DECISIONS.md#d5) a child's question unparks the parent. All five as the Architect leaned, reported by the product lead as Jake's call; merging this spec is the approval. Settled: [D0](DECISIONS.md#d0) no timer on the parent.

Feature · `orchestration` + `workforce` · medium · epic FIX-1996 · P1 → P2 → P3
