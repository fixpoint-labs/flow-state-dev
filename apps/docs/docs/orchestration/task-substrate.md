---
title: Task substrate
sidebar_position: 2
sidebar_label: Task substrate
description: The Task record and storage-agnostic TaskCollection that the task board and every coordination pattern are built on.
---

# Task substrate

Coordination patterns in flow-state-dev share one shape: a list of work items that get claimed, run, and marked done. The task substrate is where that shape lives. It gives you the `Task` record and a `TaskCollection` that stores tasks and mutates them safely under concurrency. Dispatchers, the task board, and the patterns above them (Supervisor, Plan and Execute) all read and write through this one API.

Reach for it directly when you need a coordination shape none of the wrappers provide. Otherwise you're using it underneath one of them.

Import it from `@flow-state-dev/orchestration`:

```ts
import { taskSchema, type Task } from "@flow-state-dev/orchestration";
```

## The Task record

A `Task` is one unit of work. It carries what to do, where it is in its lifecycle, what it depends on, and the result once it finishes. The schema is a Zod object, so you get runtime validation and an inferred type from the same source.

| Field | Type | Meaning |
|-------|------|---------|
| `id` | `string` | Stable identifier. Auto-generated when you don't supply one. |
| `goal` | `string` | The full objective a worker acts on. Required. |
| `title` | `string?` | Short label for plan UIs. Rows render `title ?? goal`. |
| `context` | `string?` | Prose support text a worker reads (the slice of the request it needs). Distinct from `input`. |
| `status` | `TaskStatus` | Where the task is in its lifecycle. See below. |
| `deps` | `string[]?` | Ids that must reach `completed` before this task is eligible. |
| `input` | `TInput?` | Typed payload handed to the worker. |
| `output` | `TOutput?` | Typed result written by `complete`. |
| `error` | `string?` | Message written by a hard `fail`. |
| `feedback` | `string?` | Message written by a soft `fail` or a review, readable on the next attempt. |
| `attempts` | `number` | How many times the task has been claimed. Starts at 0. |
| `maxAttempts` | `number?` | Optional retry budget. Governs soft vs hard fail. |
| `assignee` | `string?` | Worker key a board uses to route the task. |
| `priority` | `number?` | Higher wins under the priority dispatcher. Unset reads as 0. |
| `leaseUntil` | `number?` | When the current claim expires. The worker holding the task pushes this out while it works. |
| `leaseDurationMs` | `number?` | How long the current claim was granted, as the claim wrote it. Read it with `committedLeaseSpan(task)` rather than subtracting the stamps yourself — every other write to the task moves `updatedAt`. |
| `abandonments` | `number?` | How many times this task was handed back out after its worker stopped renewing the lease. |
| `questions` | `TaskQuestion[]?` | What the task is waiting on a person for: its questions and confirms, and a stop its run waits on. See [waiting on questions](#waiting-on-questions). |
| `turn` | `number?` | Counts the turns the task has run. Every claim advances it, so two turns of one attempt hold different claims. |
| `labels` | `string[]?` | Free-form tags, filterable via `hasLabel` / `hasAllLabels`. |
| `metadata` | `Record<string, unknown>?` | Arbitrary structured data. |
| `createdAt` / `updatedAt` | `number` | Epoch ms. |
| `startedAt` / `completedAt` | `number?` | Epoch ms, stamped on first claim and on `complete`. |
| `revision` | `number?` | Counter advanced by every write that changed the task. |
| `writeLog` | `{ id: string; revision: number }[]?` | Bounded, newest-last log of write receipts. Read through `didWriteLand`, not directly. |
| `writeLogTruncated` | `boolean?` | Whether the log has ever dropped a receipt. |
| `incarnationId` | `string?` | Identifies this task apart from an earlier one that used the same id. |

The last four are write provenance. They exist so a caller can find out whether its own write committed, and they are maintained by the collection rather than by you. See [telling whether your write landed](#telling-whether-your-write-landed).

`input` and `output` validate as `unknown` on the schema. The runtime type `Task<TInput, TOutput>` narrows them at your call site, so a board over a typed collection surfaces real payload types at the worker boundary.

### The status state machine

A task moves through a fixed set of statuses, and the substrate enforces the transitions.

```
pending ─┬─→ in_progress ─┬─→ completed
         │                ├─→ errored
         │                ├─→ pending           (reclaim, after a stale lease)
         │                └─→ cancelled
         ├─→ held ─┬─→ pending                  (release)
         │         └─→ cancelled
         └─→ cancelled
```

`completed`, `errored`, and `cancelled` are terminal. Once a task lands there, every status write treats it as final, and its output never changes. Its labels, priority and metadata still take a write ([below](#what-a-write-reports)). To correct or extend finished work, file a follow-up task (`followUpOf`); see [Task board](./task-board.md#which-session-a-task-runs-in). A task that has reached any of the three is *settled*, the term the board and pattern pages use for a terminal task regardless of which status it landed on. `pending`, `in_progress`, and `held` are live states a task can still move out of. A move to the status a task already holds is on the table, so a repeat write doesn't throw.

Any other move not on that diagram is refused. You cannot drop a `completed` task back into `in_progress`; the call throws an `IllegalTaskTransitionError` carrying `taskId`, `from`, and `to`, and nothing is written.

That is what you get driving a collection from your own code. A model driving a board through the task tools sees something different: those tools catch this one error and return `{ ok: false, error: "illegal_status_transition: …" }`, naming the task's current status and the calls available from it, so a refused change reads like every other bad tool call.

`complete` and `fail` also take an option that makes one write *advisory*, so a refused transition does nothing instead of throwing. It is opt-in per call and off by default; see [recording a result that may no longer apply](#recording-a-result-that-may-no-longer-apply) below.

The status helpers are exported so you can reason about transitions without hardcoding the table:

```ts
import {
  isTerminalStatus,
  isTransitionAllowed,
  allowedTransitionsFrom,
} from "@flow-state-dev/orchestration";

isTerminalStatus("completed"); // true
isTransitionAllowed("pending", "completed"); // false — must go through in_progress
allowedTransitionsFrom("in_progress"); // ["completed", "errored", "pending", "cancelled"]
```

### Soft fail vs hard fail

`fail` behaves differently depending on whether the task carries a retry budget.

Set `maxAttempts` and, while `attempts < maxAttempts`, a call to `fail` is a *soft* fail: the task flips back to `pending`, the error is captured on `feedback`, and the next claim increments `attempts` for a fresh run. Leave `maxAttempts` unset and `fail` is a *hard* fail: the task goes straight to terminal `errored` with the error on `task.error`. Single-attempt is the default.

### Holding a task until someone releases it

A *held* task is filed but won't start. No claim takes it, whatever its `deps`, until something releases it. File one held with `createTask({ ..., held: true })`, or hold a pending one later with `hold(id)`. `release(id)` puts it back in `pending`, and from there it starts like any other task once its `deps` have finished.

A held task keeps a board from finishing: nothing will start it, so a [task board](./task-board.md#termination-onidle-modes)'s drain reports it with the failures, as `"blocked-by-failures"`. Release it, or cancel it, to let the board finish.

### Waiting on questions

A task can also wait on a person's answers. Its `questions` list what it waits on, each with an `id`, the `ask` (`kind` and `prompt`), when it was opened (`openedAt`), and a `due` time when a deadline applies. `openQuestions(task)` returns the ones still open. A task with an open question starts no turn: no claim takes it, and nothing renews or reclaims its lease.

There are two kinds, told apart by `source.kind`:

- **A question or a confirm** (`"row"`). File the task with `createTask({ ..., questions: [{ kind: "question", prompt }] })` and it stays `pending` until each is answered. A worker asks midway with `ask(id, asks, { claim })`, from the turn holding the task's claim: the write drops the lease and the turn ends without settling the task, which stays `in_progress`. A `confirm` asks for a yes or a no. Its `ask.onNo` says what a No does: `"cancel"`, the default, or `"continue"`. The collection stores it; the board's `updateTask` acts on it, cancelling the task on a `"cancel"` No.
- **A stop its run waits on** (`"suspension"`). When a run working the task waits for a person (`ctx.waitForUser`), the task records the stop here with its `requestId` and `suspensionId`, and the run's resume closes it.

`answer(id, { questionId, message, from })` answers one question. The answer is kept on the task as a message carrying the question's id, so it joins the next turn's brief. The last answer lets the work go on in the same write: a task that hadn't started can be claimed, and one asked midway owes one more turn on its same attempt, which the next claim takes without charging `maxAttempts`. Sending the same words again reports `unchanged`, even after the task has finished. Different words for a question already answered are declined `answered`.

A question has no deadline unless the host sets [`userDeadlineMs`](/docs/configuration/runtime#createflowstate-fields). Past one, `payQuestionDeadlines()` (which a board runs on every touch) closes the question with "No answer came before this question's deadline. Go on from your brief without it.", which lets the work go on as an answer would.

A task with open questions settles only by a cancel, which closes every question; an answer closes its own question and the work goes on. A turn waits once: it can't ask questions while its run waits on a stop, and its run can't stop for a person while its own questions are open.

### Changing a filing before it starts

Until a task first starts, three of the things it was filed with can still change: whether it is held, its `deps`, and its `maxAttempts`. `patchSettings(id, patch)` changes any of them in one write. `hold` and `release` are the same write under their own names. A release on its own is never refused this way: leaving `held` is how a task starts again.

```ts
await tasks.patchSettings("draft", { deps: ["outline", "sources"], maxAttempts: 3 });
// { outcome: "recorded" }
// once it has started, even if a retry put it back in pending:
// { outcome: "declined", reason: "started", status: "pending" }
```

Once a worker has claimed the task, the answer is `started`. A retry that returns the task to `pending` doesn't make it unstarted again, because the attempts it already used are part of the record. New `deps` are checked like a filing's, below.

### Dependencies are checked when you file

`createTask`, `createTasks` and `patchSettings` refuse a dependency the board could never satisfy, and file nothing. Each refusal throws a `TaskFilingRefusedError` whose `rule` names what was wrong:

- `dependency_not_on_board`: the id names no task on this board. To wait on work somewhere else, wait on it, or file the task held and release it when the other work is done.
- `dependency_ended`: the dependency has already failed or been cancelled, so the task could never start.
- `dependency_loop`: the dependencies lead back to the task itself.

In a `createTasks` batch, the ids in the same batch count as on the board, so a batch can file a whole chain. A batch row filed already failed or cancelled counts as an ended dependency, and a batch that names one id twice is refused (`duplicate_task_id`). A refusal anywhere in the batch files none of it.

### When a task ends badly, its dependents end too

When a task fails for good or is cancelled, every open task that depends on it is cancelled, and then every open task that depends on those, down the chain. Each one is labelled `skipped`, its `error` says which dependency ended (`dep draft failed`, `dep draft was cancelled`), and `causedBy` holds the id of the task whose ending started the cascade.

The ending's own write records that the cascade is owed, and the same call pays it right after. If the process dies between the two, the debt stays on the stored row, and the next touch of the board pays it: a task board's drain, or `payOwedCascades()` when you drive the collection yourself. A touch also reads the stored tasks and cancels any unstarted task whose dependency has failed or been cancelled, which catches a dependent another process filed while the dependency was ending. A task that completes, or is retried, owes nothing to its dependents. A retried dependency may still succeed.

## TaskCollection

A `TaskCollection` stores tasks and exposes a mutation API. Every mutation is compare-and-set, so two workers claiming at the same moment do not both win the same task — see [what a durable board guarantees](#what-a-durable-board-guarantees-about-ownership) for the scope of that. You get a `TaskCollectionRef` from `getOrCreateTaskCollection`, which needs the block context and a backing choice.

The mutation surface:

- **Create** — `createTask`, `createTasks`.
- **Lifecycle** — `claim`, `renewLease`, `complete`, `fail`, `hold` / `release`, `cancel`, `reclaim` (reset stale leases back to `pending`), `payOwedCascades`.
- **Mutate** — `patchSettings` (until the task starts), `steer` / `takeSteers` (until the task finishes; [below](#messages-on-an-open-task)), `setAssignee`, `setPriority`, `addLabel` / `removeLabel`, `patchMetadata`.
- **Query** — `get`, `list`, `count`. These are synchronous reads of the latest committed view.

A task board handles expired leases for you — see [the lease](#the-lease). `reclaim` is there for the case where you want to reset leases yourself, on your own schedule.

Every mutation method except `claim` and `reclaim` resolves to a verdict describing what the write did — see [what a write reports](#what-a-write-reports).

### Reading tasks back

Reads return a `TaskHandle`, which is the `Task` plus an `items()` accessor. `items()` returns the stream items a worker emitted while it held the claim (its messages, tool calls, sources, reasoning), so an aggregator such as a synthesizer or reviewer can pick from a worker's natural output instead of relying only on `task.output`. The data fields on a handle are a snapshot; `items()` is live and re-reads on every call.

Here's a handler that seeds two tasks with a dependency between them and dispatches the one that's ready:

```ts
import { handler } from "@flow-state-dev/core";
import {
  getOrCreateTaskCollection,
  topologicalClaimOrder,
} from "@flow-state-dev/orchestration";
import { z } from "zod";

export const seedResearchPlan = handler({
  name: "seed-research-plan",
  inputSchema: z.object({ topic: z.string() }),
  outputSchema: z.object({ claimedGoal: z.string().nullable() }),
  async execute(input, ctx) {
    const collection = await getOrCreateTaskCollection({
      ctx,
      backing: "state", // no `state` field: the tasks live on the request
      collectionId: "research-plan",
    });

    await collection.createTask({
      id: "research",
      goal: `Research the current state of ${input.topic}`,
    });
    await collection.createTask({
      id: "draft",
      goal: `Draft a briefing on ${input.topic}`,
      deps: ["research"],
    });

    // "draft" waits on "research", so the topological dispatcher
    // claims "research" and leaves "draft" pending.
    const claimed = await topologicalClaimOrder.claim(collection, "writer-1", ctx);

    return { claimedGoal: claimed?.goal ?? null };
  },
});
```

### Recording a result that may no longer apply

Every lifecycle method that moves a task's status — `complete`, `fail`, `cancel` — takes an optional trailing options argument. The options argument exists for a specific situation: you claimed a task, went away to do the work, and by the time you came back somebody else had already decided the task's fate. Maybe a coordinator cancelled it. Maybe the worker marked it done itself partway through. Maybe the claim expired and another worker picked it up. Recording your result now would either be refused by the state machine, or overwrite the outcome someone else recorded. `hold` and `release` take no options argument. Like `patchSettings`, they only apply to a task that hasn't started.

Passing options makes the write *advisory*: record this only if it still makes sense, otherwise do nothing.

```ts
const task = await tasks.claim("worker-1");
if (task === null) return; // nothing eligible, or another worker got there first

const claim = ticketForClaim(tasks.collectionId, task);

// … minutes of model work …

await tasks.complete(task.id, output, {
  ifAllowed: true, // skip if the state machine won't take it
  claim,           // skip unless this is still my task
});
```

`ifAllowed` asks whether the task can take this write right now. It declines when the task has already reached a terminal status, so a repeat write cannot clobber a settlement someone else recorded, and when the state machine has no transition from the task's current status to the one the call targets.

A legal status transition is necessary but not sufficient. A verb that owns a single edge runs only from that edge's source status, so a call can be refused where the [status diagram](#the-status-state-machine) shows a line. The paths back to `pending` each have their own verb:

| Returning a task to `pending` from | Call |
|------------------------------------|------|
| `held` | `release(id)` |
| `in_progress`, once its lease has expired | `reclaim()` |

A finished task (`completed`, `errored` or `cancelled`) has no path back.

`release` on a task that isn't held reports `unchanged` and writes nothing. If you reached for it to put a *running* task back in the queue, `reclaim()` is the call, and it works differently: it takes no task id, sweeps the whole collection, resets every `in_progress` task whose lease has passed, and resolves to the number it moved.

#### Messages on an open task

`steer(id, { message, from, by?, key? })` keeps a message on a task that hasn't finished. It is the write behind `updateTask({ message })` on a [task board](./task-board.md#sending-a-message-to-an-open-task). `from` is `"filer"` or `"user"`, `by` names the person, and a `key` makes a repeated write a no-op.

```ts
await tasks.steer("release-note", { message: "Mention the new flag too.", from: "user", by: "alice" });
// { outcome: "recorded" }
// on a finished task:
// { outcome: "declined", reason: "terminal", status: "completed" }
// past the 20th message:
// { outcome: "declined", reason: "steer-limit", status: "in_progress" }
```

Messages are appended in order on the task's `steers`. Each one records the attempt that took it (`takenBy`). A claim takes every message on the task into the new attempt, and its worker input carries them as `steers`. A request already working the task takes later ones with `takeSteers(id, { claim, takenIn })`, which needs the claim's ticket, so only the attempt holding the task takes its messages. `takenIn` is a name you give the read, such as `step:<request id>`: reading again under the same name returns the same messages, so a step that runs again after a crash sees what it took the first time, and nothing is taken twice. A steer changes no status, uses no attempt and records no ending. A steer to a task waiting on work it filed sets its `keptOpenBy` to `"steer"`, so the turn that takes it can start.

`complete` with `refuseUntakenSteers: true` declines, reason `untaken-steers`, while the task holds a message its attempt hasn't taken. It is decided inside the write, so a message that lands after your own read of the row still holds the task open. Pass it only where something then gives the message a turn, as a task board's end check does.

`claim` asks who owns the task. `ticketForClaim` mints a ticket from what `claim()` handed you — the board, the task, the attempt, and the task's creation timestamp — and the write is refused unless the task in front of it is that same task, on that same attempt, in a status the attempt holds (`in_progress`). Two refusals come out of it, and they mean different things:

- The ticket names a different task, a different board, or an id that has since been reused for a new task: `not-my-task`. Nothing about the target's state can make that write legal.
- The ticket names the right task but a claim that has moved on, or an `in_progress` task whose lease has run out: `lost-claim`. Somebody else holds it now, or is entitled to.

Pass the ticket rather than the attempt number on its own. Attempt numbers collide constantly across a board (two freshly claimed tasks both sit on attempt 1), so a check against the number alone is satisfied by whichever task the call happened to name.

The task cannot change between the check and the write. Only these refusals go quiet. A missing task, a store failure, or any other error throws.

A skipped write resolves to `{ outcome: "declined", reason, status }` instead of throwing — see [what a write reports](#what-a-write-reports).

While a task is `in_progress`, your writes are good for as long as you hold the lease. Present a ticket after the deadline has passed and the write is declined `lost-claim`, the same as any other lost claim, because by then the task is the queue's to hand out again. That is the reason to size a lease to the job it covers.

One caller is entitled to more than that: a worker that has not started yet. If your claim sat in a queue and its lease ran out before the work began, `renewLease(id, deadline, { claim, adoptLapsedLease: true })` takes the task back instead of being declined — same attempt, same claim, no re-dispatch. The write is what decides it: `{ outcome: "declined", reason: "lost-claim" }` if another claimant has meanwhile taken the task, and `{ outcome: "recorded" }` if nobody has, which means the task is yours again for the deadline you just wrote. Pass `committedLeaseSpan(task)` past `now()` as that deadline, so the task keeps the lease length its claim was granted. Reach for it only from a worker that has run nothing yet. A worker already partway through the job is in the other case, where the lapse means the task may be somebody else's now, and the flag is ignored on any write except a renewal.

The lease answers one question: is a live worker on this right now? A task waiting on a person is stopped on purpose and nobody is running it. It stays `in_progress` with an open [question](#waiting-on-questions). The task isn't handed out again while it waits, however long that takes. So when a task has to wait on a person for longer than any lease you would want to set, ask a question rather than holding a claim open on a running task.

With no options object, neither guard runs. An illegal transition throws. A legal one goes through even when another attempt already recorded a result: `completed → completed` is a legal move, so a second unguarded `complete` overwrites the first output. Pass `{ ifAllowed: true }` if you drive a collection directly. `cancel` is the exception and needs nothing: it runs the terminal check whether you pass options or not.


### What a write reports

Every lifecycle and field-mutation method resolves to the same shape, so one check reads the whole write surface:

```ts
type TaskWriteDeclineReason =
  | "immutable-assignee"
  | "terminal"
  | "not-my-task"
  | "disallowed"
  | "lost-claim";

type TaskWriteOutcome =
  | { outcome: "recorded" }
  | { outcome: "unchanged" }
  | { outcome: "declined"; reason: TaskWriteDeclineReason; status: TaskStatus };
```

`recorded` means a field changed and a `task-change` item went out. `unchanged` means the task already held the state you asked for, so nothing was written and no item was emitted. `declined` means the write was refused: `status` is the status the task was in when it was refused, and `reason` says which condition stopped it.

- `immutable-assignee` — the board dispatches work to a dispatch run, and an attempt still holds the task (*in progress*, one waiting on a person included): the run was addressed by its assignee. A pending or held task can still be reassigned.
- `terminal` — the task had already reached `completed`, `errored`, or `cancelled`.
- `not-my-task` — the `claim` you passed names a different task, a different collection, or an id that has since been reused for a new task.
- `disallowed` — the state machine won't take the move from the task's current, non-terminal status, such as `pending → errored`.
- `lost-claim` — the `claim` names this task but no longer owns it. The task was reclaimed or re-queued while you were working on it, or its lease ran out while it was still `in_progress`.
- `started` — a `hold` or a `patchSettings` on a task that has already started. What a task was filed with is fixed once it runs.
- `open-question` — the task has an open [question](#waiting-on-questions). A settlement, a lease renewal and a second wait are refused until it closes. Only a cancel settles a task with an open question.
- `answered` — an `answer` with other words, or from another sender, for a question already answered.
- `no-such-question` — an `answer` naming no question or confirm on the task.

When more than one condition applies, `reason` reports the first that holds in that order: `immutable-assignee`, then `terminal`, then `not-my-task`, then `disallowed`, then `lost-claim`. The order is part of the contract, so read it in that direction: a cross-task write reports `not-my-task` rather than `disallowed`, but a write naming a task that has already finished reports `terminal` even when the claim names the wrong task too.

A decline is a value, not an error. Nothing throws, nothing is written, and discarding the return value compiles:

```ts
// Ignoring the verdict is fine.
await collection.complete("research", { summary: "…" }, { ifAllowed: true });

// Or read it.
const outcome = await collection.setAssignee("draft", "backup-writer");
if (outcome.outcome === "declined") {
  // { outcome: "declined", reason: "terminal", status: "errored" }
  console.log(`draft is ${outcome.status}, so the assignee stands`);
}
```

`cancel` needs no guards to be advisory: cancelling a task that already settled declines with reason `terminal`, and the first settlement's reason and timestamps are left alone. Pass it a `claim` and that is honoured too. The remaining lifecycle methods decline only when you pass the guards above; without them an illegal transition throws.

`setAssignee` is the one field mutator that refuses anything — it declines on a terminal task. `setPriority`, `addLabel`, `removeLabel`, and `patchMetadata` write to a terminal task, which is how a post-drain audit labels what went wrong, so those four answer only `recorded` or `unchanged`. `patchMetadata` merges the patch rather than comparing it, so it answers `recorded` even for a patch that changes nothing.

`unchanged` is a statement about the task record: no field written, no `task-change` item. On a resource-backed collection the write reaches the resource either way, so a `resource_change` event can fire for a write that reported `unchanged`.

A missing task throws on every one of these methods; those four reasons are the whole set of refusals.

If you hand `taskBoard` a `TaskCollectionRef` of your own, callers see whatever your methods return. One whose methods resolve to nothing gives no verdict, and the framework won't invent one.

A `TaskCollectionRef` of your own has to do three things:

1. Implement `renewLease`, fenced by the same claim ticket your other writes take.
2. Make your own `claim()` consider tasks whose lease has run out, take them over as a new attempt, and settle one whose abandonment allowance is spent instead of running it again.
3. Refuse any ticketed write whose lease has already run out, or a worker that lost its task can still write to it. The one exception is a renewal that passes `adoptLapsedLease` — let that one through while every other guard still holds, or a task board's dispatched work stalls behind a queue.

A ref that implements only the first renews correctly and recovers nothing. Reach for the exported `isClaimable(task, lookup, now)` rather than restating the rule, and for `committedLeaseSpan(task)` when you need the length of the lease a claim was granted.

It also has to take the trailing options argument on every write and evaluate the guards inside its own atomic section. A two-argument `complete(id, output)` satisfies the interface structurally and JavaScript drops the third argument in silence, so nothing tells you it isn't happening. A board on such a ref still finishes: where an unguarded write throws and a guarded one would have declined, the board drops that result and drains the rest of its tasks. Survival is all that buys you. The guards are what keep a late worker from overwriting a settlement somebody recorded deliberately, and a stale write the state machine happens to permit never throws at all, so nothing outside your store sees it.

Your ref also exposes `now()`, the clock it stamps and judges leases against. `() => Date.now()` is the right answer unless you have a reason for another. Compare leases against `collection.now()`, not `Date.now()`: it is the clock that stamped `leaseUntil`.

### Telling whether your write landed

A write can commit and the call still throw — the failure happens after the record changed. What reaches you is a rejected promise, and a rejected promise carries no value, so the `TaskWriteOutcome` above never gets to you.

Reading the task back afterwards doesn't settle it. Say you were failing a task with retry budget left, and by the time you look, another worker has claimed it. Two different stories produce that exact record:

1. Your write committed, the task went back to the queue, and another worker took it.
2. Your write never landed, the lease expired, a reclaim re-queued the task, and another worker took it.

The first is a real failure someone needs to hear about. The second is routine. They read identically.

To tell them apart, open a write before you make it.

```ts
import { beginTaskWrite, didWriteLand } from "@flow-state-dev/orchestration";

const write = beginTaskWrite(tasks.get(taskId));

try {
  await tasks.fail(taskId, "the worker gave up", { ifAllowed: true, claim, write });
} catch (cause) {
  switch (didWriteLand(tasks.get(taskId), write)) {
    case true:
      // It committed. Something after the write failed, and that is worth reporting.
      throw new Error("recorded the failure, then fell over", { cause });
    case false:
      return; // Nothing was written. Routine.
    case undefined:
      throw new Error("cannot tell whether the failure was recorded", { cause });
  }
}
```

`beginTaskWrite` hands back a token: a fresh id, the task's revision as you observed it, and an identity nonce naming the task's current incarnation. Pass the token on the write's options. The receipt is stored on the task itself, so it survives a later worker claiming the task.

Mint the token **before** the write. A token minted afterwards can't answer.

- `true` — your write committed. Its receipt is on the task.
- `false` — your write changed nothing. Either it never landed, or the task already held the state you asked for.
- `undefined` — cannot tell.

Surface `undefined` as its own condition instead of guessing. It means the task carries no provenance, your receipt has aged out, or the token names a different incarnation of the task — deleted and recreated under the same id between the mint and the read, whether by an explicit delete or by capacity eviction on a resource-backed collection. A task keeps its four most recent receipts, so a caller asking after several later writes can find its own gone. The answer withholds itself rather than inventing one.

A `false` says your write changed nothing. It does not say why. If you need to know whether a write was *refused* and on what grounds, that's the `declined` verdict above: a refusal is a value, not a throw. The two are worth reading together.

**Which writes you can correlate.** The methods whose options carry a write token: `complete`, `fail` and `cancel`, where the argument is optional, and `renewLease` and `linkRun` (which records the run working a claimed task), where it is required because it carries the claim ticket. `createTask`, `createTasks`, `claim`, `reclaim`, `hold`, `release`, `patchSettings` and the five field mutators advance the task's revision, so every committed write moves the record, but they take no options object and so carry no token.

**A collection ref you wrote yourself** maintains none of this. Absence of a record reads as `undefined`, never as "your write did not land".

The task board uses this on its own result writes: a write that landed but could not be announced is reported rather than passed over. See [When the board cannot record a result](./task-board#when-the-board-cannot-record-a-result).

## Backings

Where a collection stores its tasks decides how long they live. `getOrCreateTaskCollection` resolves the same `TaskCollectionRef` API over either of two backings, so your pattern code doesn't change when the storage does.

| Backing | Where the tasks live | Lifetime |
|---------|----------------------|----------|
| `state`, no `state` field | On the request (`ctx.request`) | The whole request, across block boundaries. This is where a default task board keeps them. |
| `state` with `state: ctx.sequencer` (or another state ref) | On that state | As long as that state: one sequencer invocation for `ctx.sequencer`. |
| `resource` | A resource collection declared with `defineTaskCollection` | Outlives the request: a user's task list, an org work pool that accepts tasks across sessions. |

`getOrCreateTaskCollection` accepts only `"state"` and `"resource"`. Any other value throws before anything is stored, including the [task board](./task-board.md#collection-backing) names `"request"` and `"sequencer"`. A board's request backing is `state` with no `state` field, and its sequencer backing is `state` set to the board sequencer's own state.

A sequencer's state is per-invocation because each sequencer call allocates a fresh state container. If you need the collection to survive across those calls but stay inside one request, leave `state` out. For anything that has to persist between requests, use `resource` with a session-, user-, or org-scoped resource collection.

Both backings agree on freshness *within* a request: two resolutions of the same collection read the same tasks, so a task added through one is visible through the other right away. `resource` is the only backing where the question reaches past the request, and there the guarantee stops. A request already running can't rely on seeing a write made by another request. A later request reads it.

```ts
// Durable, resource-backed queue that outlives the request.
const collection = await getOrCreateTaskCollection({
  ctx,
  backing: "resource",
  collectionId: "org-work-pool",
  collection: ctx.resources.orgTasks,
});
```

A state ref you pass must hold a `Record<string, Task>` at its state key (default `"tasks"`) in its state schema.

`getOrCreateTaskCollection` is `async` whichever backing you pick, so always `await` it. The reads on the ref it returns (`get`, `list`, `count`) are synchronous on both.

### The lease

Every claim carries a lease: how long the worker may be gone before its work is handed to somebody else. A worker the substrate drives pushes that deadline out while it runs, so a lease that expires means no worker is renewing it. The next claim on any host takes it back and runs it as a fresh attempt. Nothing to schedule, nothing to call.

Set it per claim, with `ClaimOptions.leaseDurationMs`. It defaults to two minutes.

```ts
// Two minutes, the default.
const task = await tasks.claim("worker-1");

// A dead job comes back in five seconds, at the cost of taking work
// from a worker that has merely stalled that long.
const urgent = await tasks.claim("worker-1", { leaseDurationMs: 5_000 });
```

The lease is the knob for how long a stranded job stays stranded, and picking it is a trade. Shorter means faster recovery and a higher chance of taking work off a worker that was only slow. Longer means a genuinely dead job waits. Sizing it to cover the whole job is a legitimate answer: nobody takes the task back until then.

- A lease under a second, over about 74 days, or not a finite number throws rather than being rounded into range.
- Recovery takes about one lease plus one idle-wake period, roughly 125 seconds by default, and scales with `idlePollMs`. An expiring lease writes nothing, so there is no event to wake a sleeping worker on. A spare worker re-checks on its own timeout instead, `idlePollMs × 100`, which is 5 seconds out of the box.

**A task you claim by hand gets no renewal.** You hold it, so you renew it, with `renewLease(id, deadline, { claim })`. Pass the ticket you minted from the claim; the write is refused if the task is no longer yours. If you would rather not renew, size the lease to cover the work.

Two helpers do the renewing for you. `withLeaseRenewal` wraps work that is a single call. `startLeaseRenewal` returns a `{ signal, stop }` driver for work that spans several steps, and you call `stop()` yourself on every path out. Both renew in the background while the work runs and keep one renewal in flight at a time.

Two signals are in play and they answer different questions. The `signal` you pass in, normally `ctx.signal`, says when to stop *renewing*: a cancelled request is no longer a live worker, so the driver stops pushing the deadline out. The other says when to stop *working*, and it aborts when a renewal attempt comes back declined. `withLeaseRenewal` composes the two and hands `run` the result, so pass what you are given straight to the work.

Loss is detected at a renewal, not the instant it happens. One goes out every third of the lease, so a task cancelled, settled, or reclaimed just after a successful renewal leaves the signal clear until the next attempt: about 40 seconds on the two-minute default. The signal is there to stop you paying for work you can no longer record. Correctness comes from the fence on the settling write, so make the work idempotent or cheap to repeat.

```ts
import { ticketForClaim, withLeaseRenewal } from "@flow-state-dev/orchestration";

const task = await tasks.claim("worker-1");
if (task === null) return;

const claim = ticketForClaim(tasks.collectionId, task);

await withLeaseRenewal({
  collection: tasks,
  ticket: claim,
  claimedTask: task, // the task exactly as claim() returned it
  signal: ctx.signal,
  async run(signal) {
    // Aborts on either: the request was cancelled, or the claim was
    // taken back.
    const summary = await summarize(task.goal, { signal });
    await tasks.complete(task.id, summary, { ifAllowed: true, claim });
  },
});
```

Settle the task inside `run`. Renewal has to outlive the write it protects: `complete()` and `fail()` are fenced on the claim ticket, and the fence refuses a ticketed write once the lease has run out. The span to cover is claim through settlement, not claim through the work returning. `withLeaseRenewal` stops renewing as soon as `run` returns, so a settling write issued after it is one slow store round trip from being refused, and a refused result puts the task back in the queue for another worker to run from the top.

Work that doesn't fit in one callback uses `startLeaseRenewal` instead, with `stop()` in a `finally` that closes after the settling write. The driver composes nothing for you: `driver.signal` is lease loss on its own, so run the work under it and `ctx.signal` together, with `AbortSignal.any` and a guard for a `ctx.signal` that is undefined. A step dispatched with `.step(block, { abortSignal })` gets that composition for free.

### When a job keeps being abandoned

Recovery is bounded. A task whose lease keeps lapsing is re-dispatched three times and then settled `errored` rather than handed out forever. Three is fixed; no option raises it. It is exported as `DEFAULT_MAX_ABANDONMENTS` if you want to read it.

That allowance is its own, separate from `maxAttempts`. A task with `maxAttempts: 3` that lost two workers still has all three of its failure retries.

### What a durable board guarantees about ownership

A `resource`-backed board is the one two things can reach at the same time, so it is the one where "who owns this task" needs an answer. Three facts describe it.

**One holder at a time.** Two executions racing to claim the same task: one gets the task, the other gets `null`. The loser is not an error and does not retry into a second claim; it simply has nothing to run and moves on.

This is not exactly-once dispatch. A lease that runs out sends the task back to the queue, whether its worker crashed or only stalled, so the work can run twice. Only one attempt can *record* a result: a ticketed write from a worker that no longer holds the task is refused. Side effects the losing worker already caused stand. If running the work twice is expensive, make it idempotent.

**A ticket, not a promise.** A worker's write is checked against the ticket it presents, not against who it says it is. Present no ticket and no ownership check runs — which is what a coordinator wants when it settles or cancels a task on its own board, having never claimed anything. The check is opt-in at the call, and the substrate has no notion of "coordinator" to test against.

**The limit.** The guarantee covers concurrent executions inside one process. Every store backend satisfies that. Two separate OS processes over a filesystem-backed store do not: comparison there happens under an in-process lock, so each process compares against its own view. Use SQLite or Postgres for a board two processes share.

## Dispatchers

A dispatcher decides which ready task gets claimed next. Three ship with the package. Each one scans for a candidate and then commits the claim under a conditional write that re-checks eligibility, so under contention one worker gets the task and the others move on to the next eligible one. They differ only in which tasks they consider eligible and in what order they try them.

A custom `eligibility` predicate **narrows** the substrate's candidates. Claimability is the substrate's to decide: dependencies satisfied, and either never started or abandoned by a worker that stopped renewing. Your predicate selects among the tasks that already pass it.

```ts
// Pick one task by id. Readiness is the substrate's call, and the
// commit re-checks it, so two racers cannot both win this task.
collection.claim(workerId, { eligibility: (t) => t.id === picked });
```

**Do not assert `status` in an eligibility predicate.** Other filters say which work this drain is for, and abandoned tasks matching them are still recovered. Asserting `status === "pending"` switches recovery off for that dispatcher.

An abandoned task your predicate filters out is not taken back by *this* dispatcher, so if no drain on the board matches a task, nothing recovers it.

| Dispatcher | Picks | Eligibility |
|------------|-------|-------------|
| `fifoClaimOrder` | Earliest `createdAt` eligible task | Claimable (pending or abandoned), all `deps` completed. |
| `topologicalClaimOrder` (default) | Earliest `createdAt` eligible task | Claimable (pending or abandoned), all `deps` completed. |
| `priorityClaimOrder` | Highest `priority`, ties break on `createdAt` | Claimable (pending or abandoned), all `deps` completed. Unset priority reads as 0. |

`fifoClaimOrder` and `topologicalClaimOrder` behave identically; neither one will claim a task with unmet `deps`. The two names exist so a flat fan-out with no deps can say what it means.

## task-change items

Every mutation that changes a field emits a `task-change` component item onto the stream, keyed by `${collectionId}/${taskId}` so the latest change per task replaces the previous one.

```ts
// data on a task-change component item
{
  collectionId: "research-plan",
  taskId: "draft",
  kind: "completed",         // added | claimed | completed | errored | retried |
                             // held | released | settings_changed |
                             // review_requested | resumed |
                             // cancelled | label_changed | metadata_changed |
                             // priority_changed | assignee_changed |
                             // run_linked | steered | asked | answered
  task: { /* the post-mutation Task, minus server-only fields */ },
  prevStatus: "in_progress", // omitted when the mutation didn't change status
}
```

The `task` snapshot is the post-mutation row minus the fields the substrate keeps server-side. `claimedBy` is one of those, so it is absent from the item even while a task is claimed. `run`, the dispatched run working the task, is not: a UI can open that run from it. A `run_linked` item is published on the run's own session when the run records itself on its task. A view following another session sees `run` on its next read of the board; see [Which run is working a task](./task-board.md#which-run-is-working-a-task).

UIs stay in sync off that stream rather than by polling. The `<TaskPlan />` component and the DevTool subscribe to `task-change` items, filter by `collectionId`, and rebuild the board's state from them. You don't wire any of it up: every collection `getOrCreateTaskCollection` hands you emits these items itself.

## Related pages

- [Task board](./task-board.md) — the concurrent drain built on a TaskCollection.
- [Flow policy](./flow-policy.md) — shaping the prior-work a worker sees.
- [Orchestration overview](./overview.md) — how the substrate, board, and skills fit together.
- [Flow-aware components](../ui/flow-aware-components.md) — rendering `task-change` items with `<TaskPlan />`.
