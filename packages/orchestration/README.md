# @flow-state-dev/orchestration

The orchestration substrate for flow-state-dev. One package, three layers that
build on each other:

- **Task substrate** — the `Task` schema and state machine, the storage-agnostic
  `TaskCollection`, and the claim order catalog.
- **Task board** — a concurrent drain over a `TaskCollection` with dependency
  gating and per-task worker routing. The orchestration primitive that
  `supervisor`, `parallelTasks`, and `planAndExecute` (in `@flow-state-dev/patterns`)
  are built on.
- **Skills** — user-editable `SKILL.md` folders injected as inline instructions,
  plus `taskTools`, the tools a model uses to plan on a task board.

Layering: `core → orchestration → patterns`. This package depends only on
`@flow-state-dev/core` and never imports from `patterns` or `workforce`.

```bash
pnpm add @flow-state-dev/orchestration
```

## Task substrate

```ts
import { taskSchema, type Task } from "@flow-state-dev/orchestration";
```

A `Task` is the unified work-unit record: `id`, `goal`, `status`, `deps`, `lease`,
`attempts`, `retryLedger`, optional typed `input`/`output`. Status enum:
`pending | in_progress | held | completed | errored | cancelled`. A task waiting on a
person is `pending` when it was filed with questions, and `in_progress` when it asked midway or
its run stopped for the user. `holds` lists the task's questions and confirms and any stop its
run is suspended on; the filer's hold is separate, the `held` status. No worker claims a task
while anything holds it.

```
pending ─┬─→ in_progress ─┬─→ completed
         │                ├─→ errored
         │                ├─→ in_progress       (claim, after a lease runs out)
         │                ├─→ pending           (reclaim)
         │                └─→ cancelled
         ├─→ held ─┬─→ pending                  (release)
         │         └─→ cancelled
         └─→ cancelled

errored ───→ pending                            (retry)
cancelled ─→ pending                            (retry)
```

`completed`, `errored`, and `cancelled` are terminal: every write treats them as
final, apart from `retry(id)`. A completed task never reopens and its output never
changes; a follow-up (`followUpOf`) corrects or extends one.
A move to the status a task already holds is on the table, so a repeat write doesn't throw. Anything else
throws an `IllegalTaskTransitionError` carrying `taskId`, `from`, and `to`, and
writes nothing.

`retry(id)` on a `TaskCollectionRef` (optional; both built-in backings implement it) puts an
`errored` or `cancelled` task back to `pending` as the same task, keeping its id, steers,
output so far, items and spend. A failure's error becomes the next attempt's `feedback`; a
cancel's reason doesn't. The retry adds one to `retryLedger.granted`, and the next claim is a
new attempt. `maxAttempts` is unchanged, except that a task with no tries left gets one more.
A retry isn't an ending, so it cancels no dependents and sends the filer no notice. A
dependent a failure cancelled stays cancelled until it is retried itself. `retry` publishes a
`retry_requested` change and returns a `TaskWriteOutcome`. It declines with `disallowed` (the
task hasn't ended, or it completed), `settling` (its last ending is still being delivered; try
again shortly), `dependency-ended` (retry the failed dependency first), or `retry-budget` (the
state backing's `maxTotalRetries` is spent; the resource backing counts retries but doesn't
cap them).

**`retryLedger`** records the task's standing against the collection's
`maxTotalRetries` budget:

```ts
task.retryLedger;   // { granted: 2, deniedByBudget: false } | undefined
```

`granted` counts the failure retries this task was **authorized**, so it excludes
the re-entries that do not spend the budget (`release`, `reclaim`) and includes a retry that was granted but never picked up.
`deniedByBudget` turns `true` once a retry was refused because the collection's
budget was spent; the board's `terminationReason` reads that flag, so branch on it
rather than parsing the error string.

The field is **absent** on a task that has never failed, so read it with a single
guard — `task.retryLedger?.granted ?? 0` — and treat absent as zero granted, not
denied.

### TaskCollection

`getOrCreateTaskCollection` resolves a `TaskCollectionRef` over one of two backings.
`backing: "state"` keeps tasks in block or request state: on the request when you pass no `state`
(the `taskBoard` default; survives block boundaries within a request), or on a state ref you
pass, such as `ctx.sequencer` for one board invocation. `backing: "resource"` outlives the
request: a user's queue, an org work pool, declared with `defineTaskCollection`. Every
mutation that changes a field emits a `task-change` component item.

**A ledger per partition.** A `user`-scoped collection can take a `partitionBy`
function, keeping one set of rows per partition at the user's scope:

```ts
const work = defineTaskCollection({
  id: "work",
  scope: "user",
  partitionBy: ({ sessionId }) => conversationKey(sessionId), // from data only the server writes
});
```

A board over it resolved in one session reads, claims, waits on and settles only the
partition that session's context names, and so do its task tools. That is how each
conversation keeps a board of its own whose rows a task entry on another flow still
works: the user scope crosses the flow, and a board's dispatch puts the partition on
the dispatch, so the receiving gate reads the row there (a `taskLedgers` resolver gets
it as its third argument; pass it to `getOrCreateTaskCollection({ partition })`).
Return a value no caller can set, and one minted per owner: a session id alone is
reused when a session is deleted and created again. The function gets only the
running session's server-set identity (`{ sessionId, lineageId?, userId, orgId?,
tenantId? }`), nothing a caller supplies. `lineageId` is minted when the session's
record is created, so `sessionId` plus `lineageId` names one incarnation of the
session. The function may be async, to look up a value the server keeps by that id.
Task ids on a partitioned ledger are one
path segment, and `maxInstances` is refused, since it would count every partition.
A request loads a partition's rows on that partition's first read, never the whole
ledger. The rows sit in the user's own storage, which every flow of theirs reads, even on a flow
that isolates its user state (`isolateUserState`).

A partitioned ledger keeps an id index beside its rows, so a task can be found by id
alone. Install the ledger with `taskLedgerResources(ledger)`, which returns the ledger
under its id and, for a partitioned one, the index beside it; adding a task through a flow
that installs the ledger without the index throws, naming `taskLedgerResources`. An
unpartitioned ledger gets only itself back. `findTaskPartitions(ctx, ledgerId, taskId)`
returns the running user's partitions holding that id: none, one, or several when the
same id was picked in more than one. It returns partitions only; read the row through
`getOrCreateTaskCollection({ partition })`.

```ts
import { findTaskPartitions, taskLedgerResources } from "@flow-state-dev/orchestration/tasks";

// In the flow definition, for the `work` ledger above:
const resources = { ...taskLedgerResources(work) };

// In a block, with its `ctx`:
const partitions = await findTaskPartitions(ctx, "work", taskId); // what partitionBy returned for each
```

**Recording how a task ended.** `recordEnding` is handed every write that records an
ending (a completion, a failure with or without attempts left, a park, a cancel, and
a claim settling a row whose worker died too often), inside that same write, and the
row keeps the `metadata` it returns:

```ts
const work = defineTaskCollection({
  id: "work",
  scope: "user",
  partitionBy: ({ sessionId, lineageId }) => `${sessionId}~${lineageId}`,
  recordEnding: (row, ending) =>
    ending.kind === "completed" ? { ...row, metadata: { ...row.metadata, toTell: ending.kind } } : row,
});
```

Whatever it adds lands with the ending or not at all, so a follow-up the ending owes
(someone to tell) can't be lost between two writes. Keep it a pure function of the row
and the ending: a write that loses a version race runs it again on the fresher row.

**Server-only task fields.** A `task-change` item carries the whole post-mutation
row, and that stream is client-visible. A few fields on `Task` are substrate
bookkeeping that must not reach a browser — `claimedBy`, the execution coordinate a
claim records — so the factory omits them from the emitted payload via
`toEmittedTask`, which honours the exported `SERVER_ONLY_TASK_FIELDS` set. If you
wire a backing's `onChange` to a client transport yourself, apply `toEmittedTask` to
`event.task` before you publish it — a field that is server-only on one boundary is
server-only on every one.

**The run link.** A dispatched task carries `run: { sessionId, requestId, attempt }`,
written by the board's claim gate inside the run's own session, before the worker
starts, through a claim-fenced write (`linkRun`) that emits `task-change` of kind
`run_linked` on the run's own session. The run's flow is its session's `flowId`, which
may not be the board's. The next claim clears it; a settled task keeps it. It is
client-visible, unlike `claimedBy`, and no write surface a caller reaches can set it.
If you implement `TaskCollectionRef` yourself, implement `linkRun` too: a board that
dispatches calls it on every attempt.

**What a task's run spent.** A dispatched task carries `spend: { requests }`: one entry
per request its runs made, on every attempt, each with its model calls and harness runs
(`settled`), what the running request has reported so far (`live`, `null` once it ends),
and the harness and model it ran on. The board writes it from the task's own request
only: every 2 s while the request runs (`SPEND_TICK_MS`), and once more as it ends,
before the task is checked. The write is `recordSpend(id, { requestId, part, spend },
{ claim })`, fenced by the row's identity only, so a failed attempt's tokens land even
after its row settled; it emits no `task-change`. A row written before this field reads
`spend: null`. `taskSpendView(task)` folds it to `{ harness, model, inputTokens,
outputTokens, unreported, live }`, the shape `listTasks` returns from
`taskToolActions` (never to a model): tokens are `null` until something reports one,
never 0. If you implement `TaskCollectionRef` yourself, implement `recordSpend` too, or
the board writes no spend.

`rowsInSession(ledger, sessionId)` returns the rows that run in a session, in ledger
order: each row whose run link names it, with every row of its follow-up chain. Follow-ups
run in the root's session one at a time, so the list includes one that hasn't started yet.
Empty when nothing ran there.

**How far claim safety reaches.** Both backings are compare-and-swap with retry. The
state backings mutate through `atomicState`; the resource backing mutates through
`ResourceRef.updateState`, which chains writes per key within one execution context
and then persists at the version that context read. A claim written against a
stale read is refused and re-applied against the state that won, rather than
overwriting it. Two workers contending for one task cannot both land a write.

The filesystem store is safe inside one process. A durable collection shared
across replicas needs SQLite or Postgres. A stale write is refused, not
overwritten.

**Freshness is scoped to one request.** Every ref resolved over the same collection
inside a request sees the same tasks, so a task added through any of them is
immediately visible through all of them — including a ref a task-board worker
resolved before it went idle. On the resource backing, don't rely on a running
request seeing a write made by another request. A *later* request reads it.

Removals reconcile when you resolve. A task the running request removed (an explicit
`delete` on the resource collection, or a capacity eviction) stops being reported
from the next resolution onward. A ref you are already holding keeps reporting such
a task until it resolves again.

Every lifecycle transition — `complete`, `fail`, `cancel` — takes an optional
trailing `TaskTransitionOptions` argument that makes the write advisory. `ifAllowed`
skips the write when the task is already settled, or when the transition is one the
state machine refuses. No write but `retry` moves a task out of a finished status. `in_progress → pending` sits in the status table too,
but it belongs to `reclaim()`. `claim` takes a
`TaskClaimTicket` (mint one with `ticketForClaim(collectionId, claimedTask)`) and
skips the write unless the task in front of it is the one that ticket was issued
for, still on that attempt, holding a lease that has not run out. A guard cannot be
raced: the task cannot change between
the check and the write. A declined write is skipped and never throws; the call
reports it on the returned `TaskWriteOutcome`. Omit the argument and the methods
throw on an illegal transition.

A `TaskCollectionRef` you write yourself is a supported extension point. The
substrate's own write-backs contain a throw they can attribute to a decline a
conforming store would have made before committing: the late result is dropped and
the drain continues. So a board keeps draining even against a ref that drops the
options argument — a two-parameter `complete(id, output)` satisfies the interface
structurally. The guarantee is board survival, not equivalence. It fires on a throw,
so a stale write the state machine happens to permit still commits and still
clobbers, and no error a store never raises can be contained. Everything else —
a store outage on a task the worker still holds, a write that committed and then
failed on the way out — propagates unchanged. When the task was *already* settled
or displaced before the call, the seam cannot tell an outage apart from the decline
a conforming store would have made, and contains it. Don't build an alerting path
on an error the substrate may drop.

Every mutation method except `claim` and `reclaim` resolves to a
`TaskWriteOutcome`: `recorded` (a field changed and a `task-change` item was
emitted), `unchanged` (the task already held the state asked for, nothing written),
or `declined` with a `reason` (`immutable-assignee` / `terminal` / `not-my-task` /
`disallowed` / `lost-claim`, resolved in that precedence order) and the
`status` the task was in when the write was refused. `immutable-assignee` means the
board dispatches rows to a child session and an attempt holds the task (`in_progress`), where the assignee is fixed; `not-my-task`
means the ticket names a different task, a different collection, or an id since
reused; `lost-claim` means it names the right task but a claim that has
moved on. A
decline never throws, and discarding the return value is supported. `cancel` is
advisory whether or not options are passed: cancelling a settled task declines
with reason `terminal`.

`setAssignee` is the one field mutator that refuses anything — it declines on a
terminal task, and on a durable collection any dispatching board draws from it declines
every reassignment whatever the task's status (see "Dispatching tasks through a
dispatcher assignee" below).
`setPriority`, `addLabel`, `removeLabel`, and `patchMetadata` write to
a terminal task, so a post-drain failure audit can label what went wrong; those four
answer only `recorded` or `unchanged` (`patchMetadata` merges rather than compares,
so it answers `recorded` even for a no-op patch). `unchanged` is a statement about
the task record — on a resource backing the write reaches the resource either way,
so a `resource_change` can fire for an `unchanged` write. A missing task throws on
all eight.

A verdict only reaches a call that *returned*. For the path where a write commits
and the call then **throws**, pass `write: beginTaskWrite(collection.get(id))` on
the same options argument and ask `didWriteLand(collection.get(id), write)`
afterwards. It answers `true` (committed), `false` (changed nothing), or
`undefined` (cannot tell — no provenance on the record, the token names a
different incarnation of the task (delete/recreate under the same id), or the
receipt aged out of the task's four-entry log). Mint the token before the write; report `undefined`
rather than guessing. Correlation is available on the seven methods that take
`TaskTransitionOptions`. `setAssignee` — the eighth method able to decline, above
— takes no options object at all, so it and the other four field mutators advance
`task.revision` but carry no token. A hand-written `TaskCollectionRef` that
maintains no provenance leaves its callers with `undefined`, never a false `false`.

```ts
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration";

const collection = await getOrCreateTaskCollection({ ctx, backing: "state", collectionId: "plan" });
await collection.createTask({ id: "research", goal: "research the topic" });
await collection.createTask({ goal: "draft the post", deps: ["research"] });
```

### Leases and recovery

A claim carries a lease: how long the claimant may be gone before the task is
handed to somebody else. A worker the substrate drives pushes that deadline out
while it runs (`renewLease`), so a lease that runs out means no worker is
renewing it, and the next `claim` on any host takes it back as a fresh attempt.
Nothing to schedule.

`ClaimOptions.leaseDurationMs` is the knob, defaulting to two minutes. Shorter
means a stranded job comes back sooner and a merely-slow worker is likelier to
lose its task; longer means the opposite. Values under a second, over about 74
days, or non-finite throw rather than being rounded into range.

Recovery is bounded at three re-dispatches, after which the task settles
`errored`. Three is fixed, and exported as `DEFAULT_MAX_ABANDONMENTS`. That
allowance is separate from `maxAttempts`.

**A task you claim by hand gets no renewal.** You hold it, so you call
`renewLease(id, deadline, { claim })` yourself, or size the lease to cover the
work. Two helpers do it for you: `withLeaseRenewal` wraps work that is a single
call, and `startLeaseRenewal` returns a `{ signal, stop }` driver for work that
spans several steps. Both renew in the background while the work runs, keep one
renewal in flight at a time, and stop when the signal you hand them aborts.
Both also give you a second signal that aborts when a renewal comes back
declined. `withLeaseRenewal` composes it with the signal you passed and hands
`run` the result; `startLeaseRenewal` exposes it bare as `driver.signal`, so
compose that one yourself. Loss is detected at a renewal rather than the instant
it happens, and one goes out every third of the lease, so the signal can lag a
lost claim by about 40 seconds on the two-minute default. It is there to stop you
paying for work you can no longer record; the fence on the settling write is what
keeps the result correct.

Settle the task inside `withLeaseRenewal`'s `run`: it stops renewing the moment
`run` returns, so a `complete()` or `fail()` issued after it is a fenced write
on a lease nobody is keeping alive.

**A claimant that has not started yet can take a lapsed row back.**
`renewLease(id, deadline, { claim, adoptLapsedLease: true })` renews a row whose
lease has already run out, as long as the ticket still names it and the attempt
is still the row's. That is the queued-worker case — a task handed to a child
that waited longer than the lease with nobody renewing it — and the takeover is
decided by the write: it declines `lost-claim` the moment a reclaim has moved the
row on, and stays on the same attempt when it lands. It is opt-in because the
substrate cannot tell that caller apart from a stalled worker whose renewal fired
late, and only the first should take the row back. The flag applies to renewals
only; a settlement on a lapsed lease is still declined.

Renew it for `committedLeaseSpan(task)` — the duration that claim committed to,
which the claim writes onto the row (`leaseDurationMs`) rather than leaving to be
inferred from `leaseUntil - updatedAt`. Those two stamps stop agreeing as soon as
anything else writes to the row: `setPriority`, the label verbs and
`patchMetadata` all move `updatedAt` and leave the deadline alone. The renewal
driver reads the same function, so a task's cadence and its takeover cannot
disagree about one lease. A row claimed before that field existed falls back to
the subtraction.

A worker composed as several steps reaches its driver through
`currentLeaseRenewal()`. Wrap the block that claims the task in
`withLeaseRenewalScope(async () => { … })` — **as its first statement, before
any `await`** — and call `stampLeaseRenewal(driver)` inside it once the driver
exists. The scope rides `AsyncLocalStorage`, which only propagates to later
steps when it is entered before the claiming block awaits anything; stamping
with no scope open throws rather than publishing to nobody.
(`openLeaseRenewalScope()` is the same thing without the guarantee below, if you
want to manage the failure path yourself.)

The wrapper stops the driver if that block throws after the claim commits. That
window has no other cover: the step that runs the work never starts, so no
recorder and no `onSettled` fires, and a failed request does not abort its own
signal — the lease would be renewed for a task nobody is working until the host
died, and a live lease is exactly what stops `claim()` recovering it.

**Stop the driver after your fenced write, not before it.** `complete()` and
`fail()` are fenced on the claim, and the fence refuses a write on a lapsed
lease, so stopping first can get a healthy worker's finished result refused and
its work redone. A renewal in flight across the settlement is harmless: it
writes only `leaseUntil`, and on a settled row it is declined and the driver
stops itself.

`isClaimable(task, lookup, now)` is the substrate's admission rule, exported so
a custom `TaskCollectionRef` can read it rather than restating it. It answers
admission only — whether an admitted row is handed out or settled because its
allowance is spent is `claimDisposition(task, now, max)`, exported alongside it.
Anything that reports *which* task runs next needs both; anything asking only
*whether* there is work to do needs the first. Compare leases against
`collection.now()`, not `Date.now()`: it is the clock that stamped `leaseUntil`.

### Claim orders

`fifoClaimOrder`, `topologicalClaimOrder` (the default), and `priorityClaimOrder`. None of
them claims a task whose `deps` aren't all `completed`. That eligibility rule lives
on `collection.claim`, and a claim order's own `eligibility` narrows it, so they
differ only in ordering. `fifoClaimOrder` and
`topologicalClaimOrder` are ordered identically; `priorityClaimOrder` takes the
highest `priority` first, ties on `createdAt`.

## Task board

```ts
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
```

`taskBoard({ name, collection, workers, ... })` returns
`{ drain, collectionId, capability, backing, mode, boardId, dispatchers, hasIdlessInitialTasks, caps }`.
Mount `board.drain` in a sequencer. `hasIdlessInitialTasks` is `true` when any
`initialTasks` entry omits an `id`; an idless seed re-adds on every drain, which is
why `goalSeekLoop` rejects such a board when `maxIterations > 1`. `workers` is a
single uniform worker or a
`{ [assignee]: block }` registry; each task's `assignee` routes it. Config:
`mode` (`"plan"` default | `"delegation"` — whether the drain waits on its tasks: a plan
board runs every task inline and waits on each, a delegation board hands every task to
another session through a dispatcher assignee and waits on none; a plan board holding a
dispatcher, a delegation board with an inline assignee, and a delegation board with no
dispatcher are refused at construction, naming the fix),
`defaultWorker` (optional fallback for a task whose assignee is unmatched or
omitted — reached only on a miss, declared workers untouched; may be a task
dispatcher, see below),
`concurrency` (default 4), `claimOrder` (default `"topological"`),
`onIdle` (`"complete-or-blocked"` default | `"complete"` | `"wait"`; a running task waiting
on a person, on a question or stopped for a review or an approval, is in flight but doesn't
count as active work, so a `"complete-or-blocked"` board whose open tasks only wait on a person stops
`blocked` and leaves them as they are), `initialTasks`,
`onError`, `maxIterations` (per-worker claim-loop cap, default 10000), the two creation caps
`maxEnqueuedTasks` (default 100 — tasks addable while others are `pending`,
refreshes on drain) and `maxTotalTasks` (default 500 — lifetime count incl.
terminal, never refunded), and the retry budget `maxTotalRetries` (default 50 —
failure retries the board may authorize across every task). The creation caps take a
positive integer or `null` (explicitly unbounded); `maxTotalRetries` takes a
**nonnegative** integer or `null`, so `0` means "run every task once, never retry".

`taskToolActions(board)` returns the filer's task tools over `board` as a flow `actions`
map, plus `retryTask`. Each is named `<tool>_<suffix>`, where `taskToolSuffix(collectionId)` turns every
character outside `[a-zA-Z0-9_-]` into `_` (`updateTask_todos`, `retryTask_todos`). `retryTask` takes `{ id }`
and calls the collection's `retry`, answering `{ ok: true }` or `{ ok: false, error, taskId }`
(`task_finished`, `not_finished`, `dependency_ended`, `settling`, `retry_budget_spent`,
`task_not_found`, `retry_not_supported`); it is an action only, not a model tool. Spread it into
`defineFlow({ actions })`. Each action composes `board.capability`, so the flow need not
declare the collection; none claims or drains; a transition the task cannot make returns
`{ ok: false, error }` and writes nothing. It throws unless the board is on a
`defineTaskCollection` collection. `taskToolActions(collectionId, resolve)` takes a ledger
you resolve yourself. Both take an optional roster last, the same one
`createTaskToolsCapability` takes. These are **public** actions: anyone who can call the flow can settle
or reassign its tasks. See the docs, "Changing tasks from outside a run".
`taskToolReads(collectionId, resolve)` returns the same `listTasks_<suffix>` listing as a
flow `reads` map, for an app that polls the board: it answers what the action answers and
stores nothing. Spread it into `defineFlow({ reads })`.
Omission reapplies the default on all three. They apply only when the board
constructs its own collection — a supplied `collection` is left alone and passing
any of them is a construction error, so configure caps on
`getOrCreateTaskCollection`'s `state` backing instead. Per-task retries
are set via `maxAttempts` on each task (`TaskInit`), not on the board. At the retry
budget the failing task settles terminal `errored` and the board's completion item
reports `terminationReason: "retry-budget-exhausted"` alongside `counts.retries` and
the limit in force. See the
[Task board guide](https://flow-state.dev/docs/orchestration/task-board).

**A failure no retry can change.** A worker that knows the next attempt would end the
same way throws `TaskEndsForGoodError` (from `@flow-state-dev/orchestration/task-board`)
instead of writing the ending itself, naming the task it holds (`{ taskId }`). The
board's error recorder then ends that row on this attempt, under the worker's claim,
with the error's message as its reason: `errored` with attempts left unspent (`fail`
with `noRetry`), or `cancelled` when constructed with `{ taskId, ending: "cancelled" }`.
A marker naming another row (one rethrown by a board nested inside the worker) and any
other error take the ordinary retry route.

**When the board cannot record a result.** Saving a result is a commit followed by a
change announcement, and the announcement can fail on its own. The board's two
recorders correlate every result write (`beginTaskWrite` / `didWriteLand`, above) and
report one that landed — or that they cannot account for — on a persisted
`task-board-recorder-failure` component item carrying `{ collectionId, taskId,
recorder: "complete" | "fail", verdict: "committed" | "undetermined", error, runId? }`.
The drain then **fails the run**, after every other task has finished, with a
`TaskBoardRecorderFailureError` (`code: "task-board-recorder-failure"`) naming every
affected task; on a dispatched row, which has no batch to drain, the failure fails that
child run instead. `onError` is not consulted on this path — it is a policy about a task
going wrong, not about the board's bookkeeping. A write that demonstrably committed
nothing is unchanged and still takes the ordinary error path. `verdict: "undetermined"`
is the permanent answer on a caller-supplied `TaskCollectionRef`, and on rows that
predate write provenance; such a row is also released rather than left claimed. If the
report itself cannot be emitted, the run fails immediately with a
`TaskBoardReportFailureError` instead. `task-board-recorder-failure` is excluded from
per-task item attribution — it is the substrate's, not the worker's — and is suppressed in
`chatAssistantRenderers`; an app with its own renderer registry should add
`component: { "task-board-recorder-failure": false }`, as it already does for `task-change`.
The recorders themselves (`createRecordSuccess` / `createRecordError`) **raise** a recorder
failure by default; only a composition that supplies a tail able to read the report — which
`taskBoard()`'s drain does — passes `recorderFailure: { onRecorderFailure: "defer" }`.

#### Dispatching tasks through a dispatcher assignee

An assignee under `workers` is a block. On a board declared `mode: "delegation"`, put a
`dispatcher({ action, session })` in that position and the assignee dispatches its tasks:
the drain claims a row, sends a `task` dispatch to the flow's `task.actions[action]`
entry, and moves on, while the entry's block runs in a **child session** of the session
that drained — on a request of its own — and settles the row itself. Every assignee on a
delegation board dispatches, and the drain waits on none of its rows; a board that runs
its assignees inline is a plan board (the default), which waits on every row and takes
no dispatcher. `taskBoard()` refuses a board whose assignees contradict its mode, naming
the fix. The worker is declared once, on the flow, exactly like an
action. An assignee holding anything other than a block (an object such as
`{ worker, dispatch }` or `{ block, session }`) is refused by name at construction.

```ts
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { taskSettledEntry, taskSettledInputSchema } from "@flow-state-dev/orchestration";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";

const issueLedger = defineTaskCollection({
  id: "issues",
  scope: "session",
  sharedToLineage: true,               // the child session addresses the same rows
  stateSchema: z.object({ issueKey: z.string() }),
});

const board = taskBoard({
  name: "issue-work",
  boardId: "issue-work",               // required once any assignee dispatches
  mode: "delegation",                  // every row is dispatched; the drain waits on none
  collection: issueLedger,             // must be a defineTaskCollection()
  workers: {
    implement: dispatcher({            // dispatches to flow.task.actions.implement
      name: "dispatch-implement",
      action: "implement",
      session: "per-task",
    }),
  },
});

// Runs in this session once per ending of a task the board handed out.
const onEnding = handler({
  name: "on-issue-ending",
  inputSchema: taskSettledInputSchema,
  outputSchema: z.object({}),
  execute: async (notice) => {
    // notice.ending, and notice.output / notice.error / notice.question
    return {};
  },
});

export default defineFlow({
  kind: "issues",
  actions: { drain: { block: board.drain } },
  internal: { actions: { onTaskSettled: taskSettledEntry({ block: onEnding }) } }, // required
  task: { actions: { implement: { block: implementBlock } } },   // what runs in the child
})();
```

**Hearing how a task ended.** The session that filed a row hears each of its endings once, as
a request to its flow's `onTaskSettled` internal entry. `taskSettledEntry({ block, concurrency?, defer? })`
builds that entry; `defineFlow` refuses a flow that holds a board that dispatches without one,
whichever flow the rows run on. `block` takes `taskSettledInputSchema` / `TaskSettledInput`:
`{ boardId, taskId, attempt, ending, output?, error?, cancelled? }`, where `ending` is
`"completed"`, `"errored"` (failed for good) or `"cancelled"`, and `cancelled` lists, on a failure or a cancel, the dependents it cancelled that
the same session filed (they send no notice of their own). A retry sends nothing, nor does a row
the filer waited on (`getTask` with `wait`), nor a cancel the filer's own model made with its
task tool in its turn. The block runs once per ending; if it throws, the notice stays owed and is
sent again. The entry queues on the session unless `concurrency` says otherwise.

A notice waits for the request that filed its task while that request is running, not while it is
parked on a person or a wait. The entry holds the notice back the way `defer` does (below). The
request sends what it held as it ends; once it parks, the session's pass runs about two seconds
later and sends it then, past its resend backoff. A wait in the filing request therefore reads the
ending first. A filing request whose server died mid-run holds it only until the engine can tell:
once its heartbeat has been silent past the stale-request threshold, a pass sends it, and the
stale-request sweep that marks the request interrupted brings the session's pass forward to then.
With the defaults that is within about 90 seconds of the request's last heartbeat. Before it runs
`block`, the entry takes the notice in one conditional write (the board's optional `takeNotice`,
which both built-in backings implement), so a wait that reads the task and the notice never both
deliver the same ending. A notice whose `block` threw stays owed, and the
next copy takes it over; a copy that finds the notice taken by a request that hasn't ended,
running or parked, runs nothing. Holding needs a host that records which requests are running
(durable execution, `requestHost.waits.running`); anywhere else a notice is admitted at once.

**Taking a notice in a running request.** `takeOwedNotice(ctx, notice)` takes an owed notice in
the running request's name, through the same take `onTaskSettled` uses, so a request can act on
an ending before it finishes. It answers the notice, with `cancelled` naming the dependents its
ending cancelled, or `undefined` when the row no longer owes it or another live request holds it.
Handle it, then clear it on the row with `clearNotice` from `@flow-state-dev/orchestration/tasks`:

```ts
import { takeOwedNotice } from "@flow-state-dev/orchestration";
import { clearNotice } from "@flow-state-dev/orchestration/tasks";

const taken = await takeOwedNotice(ctx, notice);
if (taken !== undefined) {
  // act on taken.ending / taken.output; `ref` is the board's task collection
  await ref.patchMetadata(taken.taskId, clearNotice(taken));
}
```

Once cleared, the copy `onTaskSettled` queued finds nothing owed and runs nothing. If the request
ends without clearing it, that copy takes it over and delivers it as usual.

**Holding a notice back.** Give `taskSettledEntry` a `defer(ctx, notice)` when the session can be
busy with something a notice must not run beside, such as a turn that is still under way. When it
answers `true`, the entry runs nothing and acknowledges nothing: the notice stays owed, and the
session's pass (below) sends it again. Each resend waits longer than the last (2 s, doubling, at most
5 minutes): that wait is the notice's *resend backoff*. A notice held back is not a failed delivery:
its age, which ends it as undeliverable past `maxDebtAgeMs`, counts from the last time it was held
back. Once the session is free, apply `resendNowPatch(row)` to each row that still owes a notice,
with `ref.patchMetadata(row.id, resendNowPatch(row))`, and run the pass: the patch drops the resend
backoff, so the pass sends the notice at once rather than at its next resend.

A notice that couldn't be sent when the row ended (the process died, the send failed) is sent
about two seconds later, or as soon as the server is running again if it was down then: on a host with durable execution and a store that keeps wakes, the
durability sweeper runs `onTaskSettled` in the filing session with an empty input, which sends
what that session's boards still owe (`payBoardDebts`) and never calls `block`. A filer whose
session is gone, or a notice still owed past the host's `maxDebtAgeMs`, is recorded on the row's
`metadata` under `noticeUndeliverable:<attempt>:<ending>` as `{ at, detail }`. User docs:
[Hearing how a task ended](https://flow-state.dev/docs/orchestration/task-board#hearing-how-a-task-ended).

That empty-input `onTaskSettled` request is the board's **pass**: it pays, in the filing session,
whatever the session's boards still owe. It is built from two exports, for a flow that runs its
own pass on another entry (named as
`passEntry` in a `defineTaskCollection({ delivery })`): `payBoardDebts(ctx, ref, options?)` pays,
in the running session, what a board's rows owe (cancels, cascades, resumes, notices past due) and
answers `{ nextDue }`, the time the next debt falls due; `settlePassWake(ctx, entry, wake, nextDue)`
then moves the session's wake for `entry` to `nextDue`, or clears it when nothing is owed. Read
`wake` with `ctx.requestHost?.wakes?.read(entry)` at the start of the pass.

`session` decides which child session an assignee's rows run in:

| `session` | Child session | Use it when |
|---|---|---|
| `"per-task"` | one per row, keyed on the task id; a task filed with `followUpOf` runs in its root task's child | rows are independent |
| `"per-worker"` | one per assignee, shared by every row the assignee runs | the worker should remember what it already did |
| `{ key: (task: TaskWorkerInput) => string }` | keyed on what the function returns, verbatim | one issue across several phases, or a key shared across assignees |
| `{ by: (task: TaskTargetQuery) => { key } \| { id } }` | chosen per row: a child keyed as `{ key }` would, or an existing session by id | some rows need a child of their own and others belong in a session that is already running |

The presets include the board id in the key, so two boards' `per-task` children stay
apart even when their task ids coincide. A custom `key` is used as returned, so two
assignees (or two boards) that return the same key share one child. A child that runs
several rows runs them under its entry's concurrency policy. An entry a `per-worker`,
`key` or `by` assignee dispatches to defaults to `queue`, so the rows run one at a time; a
`per-task` assignee's entry keeps the ordinary default (the flow's `request.concurrency`,
else `allow`). An explicit `concurrency` on the entry wins:

```ts
task: { actions: { implement: { block: implementBlock, concurrency: "allow" } } },
```

The in-process runner applies that policy, and so do queue workers that share
a lease backend. On a deployment that hands dispatches to an external queue without
one, the run starts in another worker and the entry's `concurrency` does not gate it.

A named assignee and `defaultWorker` can dispatch. A uniform `workers` block can't: it has
no assignee to route by. A `defaultWorker` dispatcher hands each task the registry
doesn't name over under the task's own assignee, and refuses a task with none
(`flow-not-found`), which fails through the board's error path.

A task dispatcher's `flowKind` may be a function, `(task, ctx) => flowId | undefined`
(sync or async; `task` is `{ assignee, taskId, input }`), called once per task at
hand-over, and only with `session: "per-task"` (any other policy throws when the
dispatcher is built). Answering `undefined` refuses the dispatch `flow-not-found`, naming the
assignee. Put it at `defaultWorker` to send every assignee without an entry of its own
to a flow looked up at that moment:

```ts
defaultWorker: dispatcher({
  name: "dispatch-by-assignee",
  action: "work",
  session: "per-task",
  flowKind: (task, ctx) => findFlowFor(task.assignee, ctx),
}),
```

**Entry and session per row.** A task dispatcher's `action` may be `{ among, by }`:
`by(task, ctx)` (sync or async; `task` is `{ assignee, taskId, input, filedBy? }`) returns
one of the entry names in `among`. Every name in `among` is checked by `defineFlow` like a
string `action`; an answer outside it refuses `no-entry` before anything is dispatched,
and the row fails through the board's error path. Its `session` may be `{ by }`, which
answers `{ key }` (a child, created with the dispatcher's `state` if it declares one) or
`{ id }` (an existing session, delivered into and never created; a missing one refuses
`session-not-found`, one this principal can't reach on this flow `session-not-found` or
`session-not-addressable`). Read both answers off fields your code wrote on the row. One
assignee can then send replies into a running session and other work to children:

```ts
// filed(task): the fields your code wrote on the row when it filed it.
assistant: dispatcher({
  name: "dispatch-assistant",
  action: { among: ["work", "reply"], by: (task) => (filed(task).reply ? "reply" : "work") },
  session: {
    by: (task) => (filed(task).sessionId ? { id: filed(task).sessionId! } : { key: `work|${task.taskId}` }),
  },
}),
```

`defineFlow` refuses a flow holding a board that dispatches with no `onTaskSettled` internal
entry, a dispatch whose entry the flow forgot to declare, a task
entry no board dispatches to and no `from` serves, a task dispatcher no board holds,
two boards dispatching to one entry, and an entry with `from` that a board in the
same flow also dispatches to. `board.dispatchers` lists the assignees that dispatch, in
declaration order, with a `defaultWorker` dispatcher last (`kind: "floor"`, label `floor`).
Each entry carries `kind` (`"named"` or `"floor"`) to branch on; `label` is for messages.

**An entry served by many boards.** `taskLedgers({ name, resolve, uses?, onError?,
allowSessionState? })` returns a `TaskBinding` to pass as a task entry's `from`.
The entry then needs no board in its flow, and takes tasks from any board whose
ledger `resolve(ledgerId, ctx, partition, taskId)` returns (`Promise<TaskCollectionRef | undefined>`).
The ledger id is the `boardId` the sending board dispatches under, so a board over a
shared ledger sets `boardId` to the ledger's id. `partition` is the partition the
dispatch names when the sender's ledger keeps one per partition (`partitionBy`), and
`undefined` otherwise. Pass it through to `getOrCreateTaskCollection({ partition })`:
the gate refuses a ledger resolved at any other partition, both before it reads the
row and again before its recorders settle it. An id `resolve` doesn't answer for
throws `UnknownTaskLedgerError` (`code: "unknown-task-ledger"`, carrying `entry`,
`taskId`, `ledgerId`) before any row is read; otherwise every check below runs on
that ledger. The id arrives on the dispatch, so resolve it against `ctx`, never from
a process-wide map. `taskId` is the row the dispatch names, so a resolver can answer
only when that row is one the running session may take; it arrives on the dispatch
too, and the gate re-reads the row it names. `uses` declares the ledgers' resources,
`onError` defaults to `"skip"`, and `allowSessionState` accepts an entry whose blocks
keep session state. Each run of the entry is a task turn (`isTaskTurn(ctx)`): the run
gets `holdTaskForUser`, whose question the task waits on until the user answers, and
`suspendForUser`. The entry runs
only if its claim on the task is still current, and task-tool writes from the run can
touch only the task it holds.

```ts
task: {
  actions: {
    work: {
      block: review,
      from: taskLedgers({
        name: "review-queues",
        resolve: async (ledgerId, ctx, partition) => {
          const collection = resolveResourceCollection(ctx, ledgerId);
          return collection === undefined
            ? undefined
            : getOrCreateTaskCollection({
                ctx,
                backing: "resource",
                collectionId: ledgerId,
                collection,
                // Present for a partitioned sender; read at the running user's scope.
                ...(partition !== undefined ? { partition } : {}),
              });
        },
      }),
    },
  },
},
```

`currentWorkerClaim(ctx)`, from `@flow-state-dev/orchestration/task-board`, returns the
claim ticket (`TaskClaimTicket`, carrying `taskId` and `attempt` among others)
of the task the calling worker holds. Pass the block's own `ctx`. It answers in a worker
the board runs inline and in a worker reached through a task entry. It returns
`undefined` everywhere else: a coordinator, a block wired directly, and any other
request the worker starts or resumes. A worker's task-tool writes are limited to the
task it holds. A write naming a different task is refused with
`task_write_declined: you hold task "<held>", not "<named>"`.

```ts
const worker = handler({
  name: "report",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ result: z.string() }),
  execute: async (input, ctx) => {
    const claim = currentWorkerClaim(ctx); // undefined outside a claimed worker
    return { result: `${input.goal} (task ${claim?.taskId}, attempt ${claim?.attempt})` };
  },
});
```

The `task` dispatch carries the claim's identity (`boardId`, `taskId`, `attempt`,
`createdAt`, `incarnationId`, and `partition` on a partitioned ledger) and the worker input the drain packed at claim time —
`taskDispatchInputSchema` / `TaskDispatchInput`. That input has to be
JSON-serializable; a payload that is not fails the row in the drain. When the dispatch
arrives, the entry re-reads the row and runs the worker only if the claim is still
current: same attempt, same row (not deleted and recreated under the same id), still
`in_progress`, still routed to this assignee. Otherwise it throws
`StaleTaskClaimError` (`code: "stale-task-claim"`) and writes nothing, so the row is
left exactly as it was. If the row is still `in_progress`, whether a newer attempt,
another assignee, or a row recreated under the same id holds it, that claim runs until its
lease runs out and the next drain reclaims it; a row that was deleted, or is already
settled, has no outstanding claim, so there is nothing to reclaim. On the drain
side the dispatch block returns `{ dispatched: true, taskId, sessionId, requestId,
adopted }`, and a refused dispatch fails the row through the board's ordinary
error path, throwing the same `DispatchRefusedError` (with its `refused` code)
that a `dispatcher()` block throws.

The child settles its own row once, when the task's work is over: its request has ended,
along with the background work that request started and any the flow's `onFinished`
started; and every task it filed has ended and its ending has reached the child's
session. Until then the row stays `in_progress`, and `keptOpenBy` says why:

| `keptOpenBy` | Waiting on | Lease |
| --- | --- | --- |
| `"filed"` | tasks it filed that are open, or whose ending is still owed to the child's session | none |
| `"suspended"` | its request is suspended, a stop for a person included | none |

A row with no lease is never reclaimed, so a waiting task isn't run twice. A resume
continues the same attempt. A stop for a person (a `ctx.suspendForUser()`, or a `ctx.suspend()`
for `user_approval` or `user_input`) is also mirrored on the row as a hold.

**A task waiting on a user.** `getTask` and `listTasks` show `keptOpenBy` on a running
task, and its `holds`. A stop for a person is one with `source.kind: "suspension"`: its
`ask` (`kind` is `approval`, `review` or `input`, with the `prompt` and `title`), its `due`
(epoch ms, absent when it has none), and the `requestId` and `suspensionId` a screen
answers it by. A screen answers it through the engine's answer route (a request handle's
`answer` in `@flow-state-dev/client`); `holds` is a read convenience, never where a screen
lists what waits for a user (that is the Inbox read, below). Three other endings:

- **Cancelled.** `updateTask({ id, status: "cancelled" })` cancels the row under the stop's
  own fence (`cancelAndResume`), so an answer that arrives at the same moment is told the stop is
  resolved. The run resumes with `suspendForUser` returning `{ cancelled: true }` and runs to its
  end holding no claim: its progress writes are refused, nothing it returns is recorded, and a
  task it files is refused (`parent_cancelled`). Any other ending of the row (a cascade)
  owes the run the same resume on the row's `resumeOwed` mark, and the board's next touch
  pays it, so a crash between the cancel and the resume leaves nothing parked.
- **Stopped.** Stopping the run (the abort route) cancels the task on that attempt rather
  than failing it: a retry would ask the same thing again.
- **Its deadline.** An approval reads as a no; a review or an input fails the attempt unless
  the block catches `SuspensionTimeoutError`.

To end one stop without cancelling its task, call `ctx.requestHost.resumeWait({ suspension:
{ requestId, suspensionId }, outcome: { cancelled: true } })`: the stop resolves `cancelled`
and its block runs on, admitted for the task as any resume is. Each later request for the task in that session
checks it again; a package admits one with `taskRequestAdmission({ name, find,
answerCounts, endRules? })` first in its sequencer, where `find(ctx)` returns
`Promise<{ ref: TaskCollectionRef; row: Task } | undefined>` (the waiting row whose run is
this session, read from server-set state). A later request's answer becomes the output
only with `answerCounts: true` and a `noteTaskAnswer` tap after the step that produced it, and `afterTaskCheck(ctx, fn)` runs `fn` after that check,
such as sending the filer the notice that the task ended. `endRules: { filedWorkKeepsOpen? }`
(type `TaskEndRules`, also on `taskLedgers`) replaces what holds a task: by default its
filed tasks. Anything else that runs in the child's session, such as a message to it, is
not admitted for the task: it doesn't hold the task and isn't part of it (while the task's
turn is running, it runs after that turn), and its answer and its errors are its own. The output is the latest `reportProgress` checkpoint,
else the last answer that counts. A request that fails, aborts or is interrupted fails
the attempt, and the board's `onError` reaches it: `"skip"` settles the row and lets the
child's request complete, `"fail"` also fails that request. A result the board can't
record fails the child's request under either setting; see the recorder-failure note
under [taskBoard()](#taskboard). Before it closes the stores, disposing the router waits for any request working a
dispatched task, until it has recorded that task's outcome (settled, failed, or waiting on
something), within `shutdownDrainMs` (default 10 s).

`taskBoard()` refuses a board that dispatches unless all of these hold, naming the
board and the fix:

- **`boardId`** is declared. Every `task` dispatch names it, so renaming it orphans
  children already in flight.
- **The collection is durable** — a `defineTaskCollection()` resource backing. The
  request, sequencer, and factory backings are refused: a dispatched row outlives the
  request that claimed it.
- **A session-scoped collection declares `sharedToLineage: true`**, or the child
  would resolve an empty ledger and never find its row. `user` and `org` scope need
  nothing extra; they already span every session the principal touches. To hand
  rows to another flow and still keep a board per session, use a partitioned
  `user`-scoped collection (`partitionBy`, above).

`defineFlow` adds one more: **no dispatched entry block declares
`sessionStateSchema`**, at its root or in a composed child. Keep the block's
state on the task.

A board that dispatches anything fixes a task's assignee while an attempt holds it:
the worker name is what a running row is routed by, so `setAssignee` on an
`in_progress` task declines with reason `immutable-assignee`. A pending or held task
can still change hands. The rule belongs to the collection rather than
the board, so a second board over the same `defineTaskCollection` value declines too.

A claim carries a lease (two minutes by default), and nothing renews it between the
dispatch and the child's first step. A child that starts after the lease has lapsed
takes the row back before it runs: it renews the lease against the claim it was
dispatched with, on the same attempt, and proceeds when that write lands. It refuses
only when the renewal is declined, which is the case another drain reclaimed the row
first. So a deep queue in front of the child costs nothing, and a genuine reclaim is
still the successor's to run. The board's lease is not configurable.

On serverless without a queue adapter, the child runs inside the invocation that
started it and is bounded by that function's maximum duration. With a queue adapter
it moves to a worker process and is not.

### goalSeekLoop

```ts
import { goalSeekLoop } from "@flow-state-dev/orchestration/task-board";
```

`goalSeekLoop({ name, board, seed?, judge, maxIterations, finalize?, ... })` wraps a
board's drain in an outer, judge-gated loop: seed → drain → judge → (replan) →
repeat → finalize. The `judge` returns a three-way `Verdict`
(`done`/`continue`/`replan`); `maxIterations` is a mandatory finite backstop, and
the loop lands with a typed `goal-seek-loop-termination` item rather than hanging.
The board must be request- or resource-backed and a plan board: a delegation board, whose
drain returns while its tasks still run, is refused at construction. `parallelTasks` and `planAndExecute`
are expressed on it. See the [GoalSeekLoop guide](https://flow-state.dev/docs/orchestration/goal-seek-loop).

## Task tools

```ts
import { createTaskToolsCapability } from "@flow-state-dev/orchestration";
```

`taskTools` are the tools a model uses to plan on a task board: the filer's `createTask`,
`getTask`, `listTasks` and `updateTask`. The worker's own tools, `reportProgress`, `holdTaskForUser` and
`suspendForUser`, are built apart ([below](#progress-from-the-worker)). No tool finishes a task: a task ends when its worker's turn
returns or throws.
`createTaskToolsCapability(resolver, roster?)` points them at a
board, and an optional roster makes `createTask` and `updateTask` refuse
an assignee it does not name. The roster can be a function of the running block's
context, read on each call that checks an assignee, for a board whose team changes
while it is in use. `taskToolActions` exposes the same tools as flow
actions. With no board resolvable, a call returns
`{ ok: false, error: "no_delegation_board" }` rather than throwing. A new task's `input`, on
`createTask`, is a JSON object: a string, number or array is refused by the
tool's schema, so a model that would send the payload as a JSON string is told to send the object.
A new task may also carry a `title`, a short non-empty label apart from its `goal`; `listTasks`
answers it when a task has one, and a task filed without one is labelled by its goal.
`createTask` also takes `context`, `labels`, `maxAttempts` and `held: true`, which files the task
without starting it until `updateTask` releases it. A task filed from a turn that is working a
task is stamped `filedByTask` with that task's id; `listTasks({ filedByTask })` lists them.
`createTask` files one task for one piece of work: the same `goal` (ignoring case and spacing) for
the same assignee and workstream `target`, while a task for it is still open, is refused with `already_open`, naming the
open task by its title, and nothing is filed. A follow-up, and a message handed on with
`resultTo: "conversation"`, keep their own rules.

For a graph fixed in code (seeded `initialTasks`, custom collection, tuned
dispatcher), put a `taskBoard(...).drain` or a `goalSeekLoop` in the generator's
`tools:`. Any block can be a tool, and only the finalized result re-enters the
caller's history.

`updateTask({ id, ...fields })` takes its fields flat, each with one rule, checked as part of the
write (`patchSettings`), so a task that starts between a read and the write
is refused, not edited:

| Field | Allowed |
|---|---|
| `goal`, `title`, `context`, `input`, `deps`, `priority`, `labels`, `metadata`, `assignee`, `maxAttempts` | Before the task first starts |
| `status: "held"` / `"pending"` | Before the task first starts |
| `status: "cancelled"` | Until the task finishes, sent alone |
| `message` | Until the task finishes, sent alone ([steers](#messages-on-an-open-task)) |

*Before it first starts* means no attempt ever claimed it (`hasStarted(task)`), so a task back in
`pending` after a failed attempt stays locked. `labels` replaces the list; `metadata` merges.
`TASK_FIELD_RULES` and `lockedFields(task, fields)` export the table. The refusals are
`field_locked_after_start` (naming the fields and the status), `task_finished` (a message
included: "a finished task takes no message; file a follow-up"), `cancel_takes_no_edits`,
`message_takes_no_edits` (a message is its own write, so it is sent alone), `nothing_to_update`,
`steer_limit` and `message_not_supported` (a board whose collection keeps no steers). Every
check runs before the write, so a refused call writes nothing. A cancel through the tool writes
`cancelledVia: "tool"`, or `"action"` through `taskToolActions`.

On a board that starts work on filing, `createTask` starts a task as soon as it is filed. Pass
`createTaskToolsCapability(resolver, roster, { dispatches: true })` only when something starts a
ready row as soon as it's written, the way a Workforce conversation does; `taskToolActions(collectionId,
resolve, roster, { dispatches: true })` does the same for the actions. On such a board a task
filed `held: true` waits until `updateTask({ id, status: "pending" })` releases it, and the same
write can name its `assignee`. `dispatches` defaults to `false`: `createTask` then files a row
the drain runs.

Each `listTasks` row can also carry a `run` link, `{ sessionId, requestId }`, naming the run
working the task or the one that last did. A row has none until a run starts on it, and a new
claim clears it until the next run starts.

`getTask({ id })` returns one task whole, for a model that has to answer from what the
task found rather than from its `listTasks` row: its goal, `context`, `input`, the fields
`updateTask` edits (`deps`, `priority`, `labels`, `metadata`, `assignee`, `maxAttempts`),
`status`, `attempts`, `statusNote`, `filedByTask`, `output` with `checkpoint: true` when it is a
reported checkpoint, `error`, `question`, `followUpOf`, `run` and `completedAt`, and `current`:
the latest completed follow-up of the task's chain, `{ id, output, outputCut? }`, when one exists.
A `listTasks` row names it by id only (`current: { id }`).
`output` is the result as the worker recorded it. A result longer than 20,000 characters as JSON
comes back as that text cut to 20,000 characters, with `outputCut: true`; an `input` or
`metadata` that long is cut the same way, with `inputCut` or `metadataCut`. `holds` lists what the
task waits on. `run` is the same link `listTasks` carries. A task the
board doesn't hold answers `{ ok: false, error: "task_not_found", taskId }`.

> **Which surfaces are capped.** The caps come from the code that constructs the
> collection, so they cover boards `taskBoard` builds itself, not the capability
> surface on its own. A resolver you hand to `createTaskToolsCapability(resolver)`
> is bounded only if the collection it returns was built with
> `getOrCreateTaskCollection({ …, maxTotalTasks, maxEnqueuedTasks })`.

**Every `taskTools` call reports a problem the same way.** A change the task's
state does not permit is a recoverable tool result, not a throw: `updateTask` on a
started task answers `{ ok: false, error: "field_locked_after_start: …" }`, naming the
fields and the task's status. So the recoverable set across the tools is
`no_delegation_board`, `task_not_found`, `unknown_assignee`,
`enqueued_task_cap_exceeded`, `total_task_cap_exceeded`,
`field_locked_after_start`, `task_finished`, `cancel_takes_no_edits`, `nothing_to_update`,
`create_task_does_not_wait`, `terminal_task_write_declined`,
`follow_up_takes_no_assignee`, `follow_up_of_unrun`,
`task_id_taken`, and a filing refusal, which names its rule
(`dependency_not_on_board`, `dependency_ended`, `dependency_loop`, and the rest of
`TaskFilingRule`), and the `wait_*` codes when `getTask`
[waits](#waiting-for-a-tasks-answer). A
coordinator rule like "when a tool returns `ok: false`, re-plan" covers all of them.
`follow_up_takes_no_assignee` through `task_id_taken` come from
[follow-ups](#following-up-on-a-finished-task), below.

Match those by **prefix, not equality**. `no_delegation_board`, `task_not_found`,
`enqueued_task_cap_exceeded`, and `total_task_cap_exceeded` are the whole `error`
string, except that `task_not_found` carries a sentence when a follow-up names a task
that isn't on the board. Every other code is followed by `: ` and a sentence of guidance for the
model, so `error === "field_locked_after_start"` never matches. Use
`error.startsWith("field_locked_after_start")`. There is no separate structured
`code` field.

Only the *tool* boundary translates a refusal into a result. Driving a collection
directly throws, and the error is an exported class you can catch:

```ts
import { IllegalTaskTransitionError } from "@flow-state-dev/orchestration";

try {
  await collection.complete(taskId, output);
} catch (err) {
  if (err instanceof IllegalTaskTransitionError) {
    // err.taskId, err.from, err.to — the refused move.
  }
  throw err;
}
```

Catch it by type, not with a blanket `catch`: a CAS conflict, a scope-mutation
timeout, or a storage failure is not a task-state problem and should keep
propagating.

The one exception is a call that asked for it. `complete` and `fail` accept the
advisory options described under [TaskCollection](#taskcollection) above, and a
refused transition on such a call is a returned `declined` verdict rather than a
throw, so it never reaches this `catch`.

At the `taskTools` boundary a `declined` verdict **does** become a tool
result: an `updateTask` cancel or edit that the collection declines answers
`{ ok: false, error: … }` rather than reporting a success that did not happen. `ok: true` from those tools means "the
backing reported no decline", not "the write happened". For the two built-in
backings those coincide, but a custom ref that reports nothing is carried past
rather than having a verdict synthesized for it.

### Waiting for a task's answer

`getTask({ id, wait: true, deadline? })` parks the calling turn on a task its session filed,
until the task ends or the deadline passes, and returns the task as `getTask` always does. The
deadline is milliseconds from the call, five minutes by default, within the host's
`waitDeadlines` bounds. A task that already ended is returned at once, and your `onTaskSettled`
block isn't called for it: a task's notice waits while the request that filed it runs, so a wait
in that request reads the ending first. If the notice was taken by `onTaskSettled` before the wait
reads the task (the filing request was parked, or another request waits), the wait returns
`{ ok: true, taskId, arrivesAsNotice: true, message }` instead of the task until `onTaskSettled` has handled that ending, including while a failed notice
waits to be sent again. A notice turn that is parked, waiting on a person for example, still counts
as handling it, so a wait answers `arrivesAsNotice` until that turn ends. The notice is how the
session hears that ending. After that, a wait returns the task as `getTask` does, with its output.
At the deadline the task runs on and nothing is cancelled. If it ends while the
waiting request is still running, that request's next `getTask` on it returns the ending. If
the request parks or ends first, the ending goes to `onTaskSettled`, once, and a wait on it after the
resume returns `arrivesAsNotice` or the task by the same rule. When the answer
is how the session hears that a task failed or was cancelled, in place of its notice, it carries
`cancelled` beside `task`: the dependents that ending cancelled, as the notice would have named
them. Any other `getTask` answer leaves them to the notice. Waits nest: a
task's own turn may wait too. A wait is refused when it would make a chain of more than five
waits (`MAX_WAIT_DEPTH`), counting the waits above you and any already below the task you wait
on.
`listTasks` marks a row a request is parked on `waitedOn: true`. `createTask` never waits: it
refuses `wait`, `deadline`, `waitForResponse` and <!-- retired-name-refusal: the refusal of the old fields -->
`timeoutMs` with `create_task_does_not_wait`, and nothing is filed. See
[Task board → Waiting on a task](https://flow-state.dev/docs/orchestration/task-board#waiting-on-a-task)
for the refusals.

`wait` and `deadline` are in `getTask`'s schema only on a board that starts work on filing, also
resumes waits, and runs on a host that can hold a wait: pass
`createTaskToolsCapability(resolver, roster, { dispatches: true, resumesWaits: true })` only when
the board also hands its rows out, so the flow holding it declares `onTaskSettled` (the filing
session's `onTaskSettled` request resumes the waiting turn when its task ends; after a crash the
session's wake sends it again), and the host has durable execution, a running durability sweeper
and a store that keeps wakes (`canHoldWait`). `resumesWaits` defaults to `false`. A composing
layer that builds its own capability gets the same per-turn list from
`taskToolsForTurn(resolver, roster, { dispatches, resumesWaits })`.

Two functions sit under the option, for a layer that builds its own board surface:

- `waitOnTask(ctx, collection, taskId, { key, step?, deadlineMs?, waitAgain?, ownBoard?, message? }, checked?)`, from
  `@flow-state-dev/orchestration/task-board`, waits on a task already filed from inside a
  block with a stable identity. `key` is what the wait is recorded under with the request (a
  tool call's logical id), and `step` the model step it belongs to (one wait per step). It runs
  every check before anything is written and resolves to `{ ok: true, task, ended }` (the task
  once it ended, or as it stands at the deadline), `{ ok: false, error, message }` with a
  `wait_*` refusal, or `{ ok: false, error: "wait_ended_the_request" }` when a person stopped
  the request or its own task was cancelled. `waitAgain: true` waits again at each deadline, as
  a plan board's drain does on a row it handed over. Each new park counts the chain again,
  except a drain's own wait (`ownBoard: true`), which is not counted again.
- `checkWait(ctx, collection, taskId, options)` runs the same checks without waiting: the
  refusal, or the checked wait to pass to `waitOnTask` as `checked`, which then doesn't check
  again. A drain uses it to refuse a row before it hands the row over.

`canHoldWait(ctx)` (re-exported from `@flow-state-dev/core`) and `waitGateId` are on the same
subpath.

A plan board can hand a row to another session and wait on it there: give `taskBoard` a
`newSession` dispatcher, and a row filed `session: "new"` runs in a session of its own while
the drain parks on it. The drain waits for the row to end, however many deadlines that takes,
before it starts the rows that depend on it. No completion notice is sent for the row. A plan
board may hold dispatcher assignees too, whose rows it waits on the same way; a plan board's
dispatcher with `wait: false` and a delegation board's with `wait: true` are refused. A drain
that fails after it handed a row over fails its request, naming the row, whatever `onError`
says, and no row that hasn't started runs. It writes nothing on the handed-over row: when the
dispatch itself threw, nothing may be running it, so it stays `in_progress` until its lease
lapses and the plan's next run claims it again. A `getTask({ id, wait: true })` on a row the
drain handed over is refused `wait_on_plan_step` for as long as the drain waits on it, deadlines
included, so no other wait can take the slot the plan waits with. Declare
the board's `onTaskSettled` entry on the flow: without it, the board still builds, and the drain hears a
row's ending at its next check-in, up to the host's default wait deadline later.

A waiting turn whose task has ended is resumed by the board's pass, which the filing session's
`onTaskSettled` runs (`payBoardDebts`, under [Task board](#task-board)). The same pass cancels each task whose wait was
stopped while its own cancel failed (`Task.cancelOwed`), and releases a wait slot that lapsed
for a request that has since ended, so an ending held for that request reaches `onTaskSettled`
even when its process died. Until that pass runs, a cancelled task's worker may keep running.

**Migrating from `resumeOwedWaits`.** `resumeOwedWaits(ctx, collection)` is no longer exported.
The board's `onTaskSettled` pass pays owed resumes and owed cancels, so drop the call and make
sure the flow holding the board declares `onTaskSettled`.

### When a worker waits on a person

A worker that can't go on without an answer asks the user. `createHoldTaskForUser({ resolve })` builds
the worker's side: `holdTaskForUser({ question })` asks it on the task the current turn is working
on, and the turn ends without settling it; `offered(ctx)` says whether the turn gets the
tool, on a task turn for a running task. The answer is a message naming the question,
`updateTask({ id, answers, message })`, from the Inbox, a line the user types in the task's
session, or the filer's own tool. The coordinator answers a question only when the task runs in a session of its own. When the task runs in the delegate's ongoing session, you answer it. The first answer
wins, and it owes the task one more turn on the same attempt, which starts from the brief, the last
checkpoint and the answer.

`createSuspendForUserTool({ resolve })` builds `suspendForUser({ kind, prompt })`, the model's stop for
the user: an approval or a review on a task turn, whose answer is the tool's result, or, on a turn
working no task, an input. On a task turn it refuses `input` and names `holdTaskForUser`. It takes the
host's person-stop deadline (`userDeadlineMs`) and none otherwise, and at a deadline it returns
`answered: false` rather than throwing. A turn waits on a person once: `holdTaskForUser` and
`suspendForUser` in the same step open one wait, and the other is refused with a tool error naming it.

**Moving from the question and review parks.** `createParkOnQuestion` and `parkOnQuestion` are gone: build `createHoldTaskForUser`. <!-- retired-name-refusal: migration note -->
`askQuestion` and `createAskQuestion` are `holdTaskForUser` and `createHoldTaskForUser`; `waitForUser` and `createWaitForUserTool` are `suspendForUser` and `createSuspendForUserTool`, and `ctx.waitForUser` is `ctx.suspendForUser`. <!-- retired-name-refusal: migration note -->
`Task.questions` and an Inbox item's `questions` are `holds` (`TaskQuestion` is `TaskHold`, `openQuestions` is `openHolds`, and so on), and `keptOpenBy: "wait"` is `"suspended"`. A row stored with the old names still reads. <!-- retired-name-refusal: migration note -->
`answerTask` and its action are gone: answer with `updateTask({ id, answers, message })`. <!-- retired-name-refusal: migration note -->
`TaskCollectionRef.awaitReview` and `unpark`, `board.unparkAndDrain` and a board's `onReview` are gone: a block asks for a review with `ctx.suspendForUser({ kind: "review", prompt })`. <!-- retired-name-refusal: migration note -->
The `parked` status, `counts.parked`, the `parked-for-review` termination reason and the `parked` notice ending are gone. <!-- retired-name-refusal: migration note -->

### Progress from the worker

`createReportProgress({ resolve })` builds the worker's `reportProgress({ statusNote?, output? })`
and an `offered(ctx)` check, the way `createHoldTaskForUser` does. It is offered only on a task
turn and acts on the task the turn holds, fenced by its claim, so it takes no id. `statusNote`
(at most `STATUS_NOTE_LIMIT` characters) shows on `listTasks` rows; `output` is a checkpoint the
task carries as its output (`Task.checkpointed: true`; `getTask` shows `checkpoint: true`). Neither changes the task's status. When the
task completes, a checkpoint stays as its output; a failed attempt keeps it for the next one. On a
finished task it answers `task_finished` and writes nothing. The collection side is
`TaskCollectionRef.reportProgress(id, progress, { claim })`, which emits `progress_reported`.

### Following up on a finished task

`createTask` takes `followUpOf` to file new work on a task: the follow-up
is a new task, with the same worker, that runs in that task's session. Its
row carries that task's `session`, `target` and `targetSessionId`, so a
follow-up of a task filed with `session: "ongoing"`, or filed for a
workstream, runs in that same session. If the session it runs in no
longer exists, the follow-up runs nowhere else: its hand-over fails it with
`session-not-found`, and its filer hears the failure. It also carries that
task's `resultTo` (where the task's result is delivered), so its result goes
to the same place. When that is `"conversation"` (a Workforce conversation),
the follow-up gets one attempt, as every task whose result goes there does.
A follow-up takes no
`session`, `target` or `resultTo` of its own (`follow_up_takes_no_session`,
`follow_up_takes_no_target`, `follow_up_takes_no_result_to`). It keeps that worker: `updateTask` won't move it
(`follow_up_takes_no_assignee`). `createTask` refuses an `assignee` beside it
(`follow_up_takes_no_assignee`) and a task that never ran with a worker
(`follow_up_of_unrun`), before anything is filed. A follow-up of a task still running
waits until that task ends, then runs. The task it follows never changes. If two
follow-ups of the same task are filed at once, the second gets `task_id_taken` (file it again).

### Messages on an open task

`updateTask({ id, message })` keeps a message on a task that hasn't finished: from the filer's
model through the tool (`from: "filer"`), or from a person through the `updateTask_<board>` action
(`from: "user"`, `by` their id from the request's verified identity). The collection write is
`TaskCollectionRef.steer(id, { message, from, by?, key? })`, appended to `Task.steers` (at most
`MAX_STEERS`, 20; past that it declines `steer-limit`; on a finished task, `terminal`). Its change
event kind is `"steered"`. No status changes, no attempt is used, no ending is recorded.

Where a message lands:

- **Before the first claim**: the claim marks every steer taken by the attempt, and the worker
  input carries them (`TaskWorkerInput.steers`), so the first brief has them.
- **While a request runs the task**: `createSteerContext({ resolve })` is a context preset that,
  before each model call, takes the steers no earlier read took (`takeSteers(id, { claim,
  takenIn })`, fenced to the claim) and renders them. `renderSteers`, `runningTaskOf` and
  `takeRunningSteers` are its parts, for a worker of your own.
- **While the task waits on work it filed** (`keptOpenBy: "filed"`): the steer sets `keptOpenBy:
  "steer"`, and the host starts the turn it is owed.
- **After the request's last model call**: an untaken message gives the task one more turn on
  the same attempt before it settles, run by the entry you name in
  `taskLedgers({ endRules: { steerTurn: { entry } } })`. A message that lands while the task is
  settling still gets it: the completion itself declines while one is untaken
  (`refuseUntakenSteers`, reason `untaken-steers`). Without `steerTurn`, the task settles and the
  message stays untaken, so on such a board a late message may not be acted on.

`getTask` returns the messages as `steers` (`{ message, from, by?, at, taken }`). A message a
request takes mid-run shows in the task's session as a line from its sender
(`showTakenSteers`); a line typed in the session is there already.

### Upgrading from stores written by an older version

A task an older version added to a partitioned ledger isn't in the ledger's id index, so
`findTaskPartitions` doesn't find it. Everything else about the row is unaffected.

Rows written before steers existed read in their new shape, with nothing to run. A row stored with
`reopened: true` reads unmarked; while it is still open, it carries one untaken message pointing
at the latest line in its session, so its next turn reads it.

## Skills

A skill is inline instructions injected into a generator's prompt. Bind skills to
**one** generator with `createSkillsLibrary` — no shared bag, no cross-agent bleed —
and configure the binding where the generator is defined:

```ts
import { createSkillsLibrary } from "@flow-state-dev/orchestration";

const skills = createSkillsLibrary({ catalog, initialSkills });

// Preload a skill, fails loud on a typo:
generator({ uses: [skills.with({ active: ["detailed-analysis"] })] });

// Let the agent load a skill mid-turn, stored in this generator's block state
// (the binding installs the block-state field for you):
generator({
  uses: [skills.with({ allowed: ["deep-research"], dynamicActivation: true })],
});
```

The up-front activator, `createSkillActivator`, picks skills before the generator runs: slash,
then keywords, then a classifier. Pass `evaluator: skillEvaluator(model)` to run that last tier
on an evaluation model. It picks one skill or none, and its answer is final.
Pass `skillEvaluator(model, { recentMessages: 3 })` to let it read the last three turns
too, so follow-ups like "yes, do that" can match.
`skillQuestions` builds the same question for an evaluator you construct yourself. See
[Tier 3 with an evaluator](https://flow-state.dev/docs/skills/activation#tier-3-with-an-evaluator).

`initialSkills` also takes a **function of the execution**, for a catalog that
belongs to the flow copy rather than to the definition — two registered copies
then seed two different sets. Pair it with `collectionConfig: { flowIsolation: true }`
so each copy reads its own storage. The resolver runs before every step of every
turn, so keep it to an O(1) read of something already resolved; and because there
is no build-time catalog under one, binding a skill by name (`active` / `allowed`)
is refused rather than left unvalidated.

### Partitioning a library

When many users or workers share one copy, use `partitionBy` instead of `flowIsolation`. It
returns the partition for the running context, and each partition gets its own catalog. Derive it
from server-written data, such as session state, never from input. A run it returns `undefined`
for reads no partition's skills: its catalog is empty, and a write to it is refused.

```ts
createSkillsLibrary({ scope: "user", partitionBy: (ctx) => ctx.session.state.workerId });
```

Seeding writes a **copy**, so a later edit to the source does not reach a catalog
that already holds the skill. `refreshSeededSkills(collection, sources)` is the
deliberate act that pulls one through. It replaces a touched skill's folder whole,
so a supporting file the source has dropped is deleted rather than left reachable;
it skips a name whose manifest is gone, so a deletion stands; and ordinary seeding
stays additive.

**`importSkillsDirectory({ overwrite: true })` is not the same thing, and picking
the wrong one is how stale instructions survive.** Both write a source skill over
one that is already there, but `overwrite` enumerates nothing — it writes the
files the source *has* and leaves everything else, so a supporting file the source
has since **dropped** stays in the folder and stays resolvable by its path.
`refreshSeededSkills` prunes it. Reach for `overwrite` when you mean
"write these on top" (a migration, a test fixture); reach for refresh when you mean
"make this match the source".

A binding that contributes the catalog contributes all of it, never the subset a
skill's `allowed-tools` names. It contributes the catalog when it preloads skills
(`active`), when it installs the load tool (`dynamicActivation`), and when it
pairs `activeState` with `allowed`; an `activeState` binding with neither
contributes no catalog tools at all. `registerCatalogTools: false` turns that
grant off while leaving the validation on, for a host that owns tool registration
itself.

A skill can't declare a team of its own. A `SKILL.md` with an `agents:` block is
refused when it loads; give the work to workers on a task board instead.

See [Per-generator binding](https://flow-state.dev/docs/skills/binding) for the
`active` / `allowed` / `activeState` surface.

### skillsManifestSource

```ts
import { skillsManifestSource } from "@flow-state-dev/orchestration";
```

`skillsManifestSource({ collectionKey?, allowed?, initialSkills? })` is the
skills domain's projection into the agent discovery door
(`discoveryTools` / `createManifestRegistry` in `@flow-state-dev/core`). It
lists what `loadSkill` will actually accept: enabled, `inline`-mode, and inside
the binding's `allowed` set when it declares one — pass the same array the
binding was given. Advertising a skill the loader then refuses sends the agent
somewhere it cannot go, so the two filters are the point rather than a
nicety. A collection key this scope does not hold throws, which the door
reports as a problem on the skills domain while every other domain still
answers.

The ambient catalog listing in the prompt is now the **`catalogContext`
preset**, on by default — an app that upgrades sees turn 1 unchanged. Pass
`catalogContext: false` in the same `.with({ ... })` call to take the listing
out and let the agent find skills through the door instead. Preset overrides
replace rather than merge, so put both flags in one call.

### resolveCatalogTools

```ts
import { resolveCatalogTools } from "@flow-state-dev/orchestration";
```

`resolveCatalogTools(agentKey, toolKeys, catalog, logPrefix)` resolves an
agent's `tools:` list against a tool catalog and returns `GeneratorTool[]`.
`agentKey` is the agent name quoted in the warning text; `toolKeys` is the
agent's declared `tools:` list (`readonly string[] | undefined`); `catalog` is
the available tools keyed by name (`Record<string, GeneratorTool>`); and
`logPrefix` is the bracket tag the warning carries (`"skills"`,
`"workforce"`). An empty or absent `toolKeys` returns `[]`. An unknown key
warns (`[skills] agent "x": unknown tool "y" — skipped`) and is dropped rather
than throwing, so one bad key in a user-authored `SKILL.md` does not take down
the agent; only own properties count, so a key like `constructor` misses. It
lives on the package root so every caller resolving a `tools:` list shares one
miss path.

## Inbox

`@flow-state-dev/orchestration/inbox` is the read an app's Inbox lists from: one item type for everything waiting on a user, and one call to answer it. It's safe to import in a browser.

```ts
import { createInboxClient, inboxItems } from "@flow-state-dev/orchestration/inbox";

const items = inboxItems({
  rows,        // task rows: a board's listTasks, or a browser's read of the board
  suspensions, // asks a reader found in sessions
  flowOf,      // the flow that owns a session
});
await createInboxClient(client).answer(items[0], { approved: true });
```

- **One item per task row** that waits on the user. A stop in that task's run lists under the row, never a second time on its own.
- **One item per suspension** that no open task's run holds, such as a user's ask in a session of their own.
- **Each question** says what it asks, where its answer goes, and whether the Inbox can answer it. An item is `answerable` when one of its questions is.
- **One item per task, however many questions it has.** A task's questions and confirms, asked at filing or midway, list oldest first as its `holds`, beside a stop in its run.
- **The answer is typed by what the question asks:** an approval takes `{ approved, data? }`, an input or a review `{ value }` (or `{ skipped: true }`), a question `{ text }`, a confirm `{ done, note? }` (a No cancels the task unless the confirm was filed with `onNo: "continue"`). `answer(item, value, questionId?)` answers the item's first question, or the one named; `answerOne(question, value)` answers one question directly. A task run's stop goes to the engine's answer route, which records who answered. A question or a confirm goes to its board's `updateTask` action, as the signed-in user, in the session that board lives in, and the call rejects with the board's refusal. A question on a board the reader can't reach says so in `unanswerable`.

### A task row, as a person sees it

`taskRowView(row, holds?)` turns one task row into what a task screen draws, so every screen uses the same words for the same row:

```ts
import { taskRowView } from "@flow-state-dev/orchestration/inbox";

const view = taskRowView(row, item?.holds);
view.state;     // "queued" | "held" | "running" | "waiting" | "failed" | "done" | "cancelled"
view.hold;  // the oldest open hold on the user (its ask, where the answer goes), or null
```

- **`waiting` wins over the stored status.** Any open hold on the user makes a row that isn't finished read `waiting`, whether it's `in_progress`, `held` or `pending`. A finished row reads as its ending, whatever an old hold says.
- **`holds` is optional.** Pass the row's Inbox item's holds when you have them: they also include a stop found in the task's run before the row records it, and they know where each answer goes. Without them, the view reads the row's own holds; those say they can't be answered from here.
- **It also carries** the stored `status` (a stored `blocked` reads `held`), `spend` with its `harness` and `model` (a raw row's stored spend is folded with `taskSpendView`; the spend `listTasks` already folded is kept as it is), `error`, `statusNote`, and `times` (created, updated, started, completed; `null` where the row has none). A stored spend it can't read comes back `null` instead of throwing.

## Documentation

- [Orchestration overview](https://flow-state.dev/docs/orchestration/overview)
- [Task substrate](https://flow-state.dev/docs/orchestration/task-substrate)
- [Task board](https://flow-state.dev/docs/orchestration/task-board)
- [Flow policy](https://flow-state.dev/docs/orchestration/flow-policy)
- [Skills](https://flow-state.dev/docs/skills/overview)

## Running tests

```bash
pnpm --filter @flow-state-dev/orchestration test
```
