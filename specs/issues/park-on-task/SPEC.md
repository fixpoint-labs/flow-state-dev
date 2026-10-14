# Park on a task: a task turn waits on another task without blocking

**Spec** · [Decisions](DECISIONS.md) · no Linear issue yet (Jake files one; this spec files none)

## Before and after

| Someone who… | Today | After |
|---|---|---|
| **is a worker on a task that needs another task's result** | Can dispatch the child, but can't wait for it. `dispatchAndWait` refuses a task turn ([`wait-for-response.ts:215`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/helpers/wait-for-response.ts#L215), FIX-1816 BR-5a). The child's ending wakes the coordinator, not this task | Dispatches the child, **parks its own row on it** and ends its request. When the child ends, the parent row is unparked and a new attempt starts with the child's `TaskNotice` as input |
| **is a coordinator** | Gets every child ending as a judgment turn, and has to relay the result by hand | Gets nothing for a child its parent parked on. The parent gets it ([D4](DECISIONS.md#d4)) |
| **is a task on one board that needs a task on another** | `deps` resolves only on its own board | Parks on the child on any board. `deps` stays same-board ([D3](DECISIONS.md#d3)) |
| **is Jake** | Most work runs as a task, so "a task can't wait" ends the road quickly | A task can wait, and no turn, lease or timer is held while it does |

Requested by Jake on 2026-10-14: *"we send and don't wait, but we also end the request if there isn't anything else we can do until the other task completes, and then wake on task completion (or failure) and start a new request as part of that wake."*

**Blocks:** the deferred task-turn wait from [#3365](https://github.com/fixpoint-labs/flow-state-dev/pull/3365) (FIX-1989 [DECISIONS D1](../FIX-1989/DECISIONS.md#d1), *"a task-turn wait is worth relaxing FIX-1816's one-deep rule, with a lease rule for the parked row, as its own issue"*). That follow-up waits on this spec, and this spec is its answer: it does not relax FIX-1816.

## The goal, and how we'll know it's met

**A task turn can dispatch a child task on any board, park on it and end its request. The child's ending (completed, errored, cancelled, or parked on a question) starts the parent's next attempt with the child's notice as input, exactly once. Nothing blocks, no wait nests, and no timer sits on the parent.**

| Is it the right goal? | |
|---|---|
| **The real need** | Work that is all tasks can still depend on other work |
| **Smaller, and rejected** | "The coordinator relays the result." It already gets the ending, but it has to judge and refile, so a chain of N needs N coordinator turns |
| **Bigger, and rejected** | A blocking wait from a task turn (relaxing FIX-1816): a nested wait holds a row's lease open, can deadlock a chain and stacks timeouts |
| **Not done if** | The parent is resumed twice for one ending · a parent stays parked forever after its child ended · the parent's lease or request is held while it is parked · the coordinator also gets a wake-turn for the same ending · a child on another board never unparks its parent · a parked parent has a timer of its own |

| How we verify | |
|---|---|
| **Goal check** | `goals/orchestration/park-on-task/` · `pnpm tsx goals/orchestration/park-on-task/run.mts`, each control as `GOAL_CONTROL=<name>` · real engine, real store, real model · run by the implementer · verdict in the implementation PR |
| **Signal** | **Leg 1:** task A's worker is told to get a fresh codename that only task B's worker (on a second board) can produce. A parks on B; A's row is `parked` with no lease and no running request while B runs; B completes; A's attempt 2 runs with B's notice and its output holds the codename. **Leg 2:** B errors; A's next attempt reads the error. **Leg 3:** the notice is replayed (restart between B's ending and A's resume); A runs attempt 2 once. **Leg 4:** the coordinator gets no wake-turn for B's ending |
| **Control that must fail** | `no-unpark` FAILS leg 1 (A stays parked) · `no-dedupe` FAILS leg 3 · `wake-coordinator` FAILS leg 4. Today's `main` FAILS leg 1: there is no park-on-task |

## What changes

1. **Park on a task.** A task turn calls `dispatchTask(target, { parkOn: true })` (name is the implementer's). It files the child, writes `parkedOn: { boardId, taskId }` on its own row, and moves it `in_progress → parked` (allowed today, [`task-status.ts:89`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/schema/task-status.ts#L89)), with the reason `waiting on task <boardId>/<taskId>`. The turn ends; the lease (`leaseUntil`, [`task.ts:184`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/schema/task.ts#L184)) is cleared.
2. **The child's ending unparks the parent.** The child's ending goes through the existing ledger path: `recordEnding` ([`task-notice.ts:118`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/notice/task-notice.ts#L118)) marks it owed, `owedNotices` (:136) lists it, `decideNotice` (:195) picks the act. A new act, `unpark-parent`, sits beside `wake-turn`, `line` and `resume-wait` ([:180–192](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/notice/task-notice.ts#L180)), chosen when the child row carries `parkedBy`. It moves the parent `parked → pending` ([`task-status.ts:91`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/schema/task-status.ts#L91)) with the notice as the next attempt's input, deduped by `noticeKey` ([:172](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/notice/task-notice.ts#L172)), and is cleared with `clearNotice` (:164).
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

- **P1 · Endings on any board.** A board that holds a parked-on child records endings (`recordEnding`) and has its owed notices delivered and replayed, not only `CONVERSATION_LEDGER_ID` ([`notice-delivery.ts:58`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/workforce/src/conversation-board/notice-delivery.ts#L58), [`board.ts:255`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/workforce/src/conversation-board/board.ts#L255)).
- **P2 · Parked-on fields.** `parkedOn` on the parent and `parkedBy` on the child in [`schema/task.ts`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/schema/task.ts); the park write clears the lease. Not on main.
- **P3 · Unpark with input.** A store write that moves `parked → pending` and carries the notice as the next attempt's input. The transition is allowed ([`task-status.ts:91`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/schema/task-status.ts#L91)) but there's no general unpark-with-input helper on main; the answer-to-question path (`feedback`, [`task.ts:136`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/orchestration/src/tasks/schema/task.ts#L136)) is the pattern to copy.

| The debt | |
|---|---|
| **Adds** | One notice act, two row fields, one park option on `dispatchTask`. Permanent |
| **Leaves** | Fan-out beyond one child ([D2](DECISIONS.md#d2)) · `deps` across boards ([D3](DECISIONS.md#d3)) |

## Sign off

**Open for Jake:** [D1](DECISIONS.md#d1) cancel a parked parent · [D2](DECISIONS.md#d2) fan-out · [D3](DECISIONS.md#d3) `deps` same-board · [D4](DECISIONS.md#d4) does the coordinator also hear · [D5](DECISIONS.md#d5) child parks on a question. Settled: [D0](DECISIONS.md#d0) no timer on the parent.

Feature · `orchestration` + `workforce` · medium · no epic · blocked by P1–P3
