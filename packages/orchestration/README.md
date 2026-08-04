# @flow-state-dev/orchestration

The orchestration substrate for flow-state-dev. One package, three layers that
build on each other:

- **Task substrate** — the `Task` schema and state machine, the storage-agnostic
  `TaskCollection`, and the dispatcher catalog.
- **Task board** — a concurrent drain over a `TaskCollection` with dependency
  gating and per-task worker routing. The orchestration primitive that
  `supervisor`, `parallelTasks`, and `planAndExecute` (in `@flow-state-dev/patterns`)
  are built on.
- **Skills** — user-editable `SKILL.md` folders injected as inline instructions,
  optionally with an `agents:` field that installs a private delegation board,
  the `taskTools` surface, and `runBoard` — the skill assigns work as tasks and
  drains the board.

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
`pending | in_progress | blocked | awaiting_review | completed | errored | cancelled`.

```
pending ─┬─→ in_progress ─┬─→ completed
         │                ├─→ errored
         │                ├─→ pending           (reclaim, after a stale lease)
         │                ├─→ cancelled
         │                └─→ awaiting_review ─┬─→ completed
         │                                     ├─→ errored
         │                                     ├─→ pending    (resumeFromReview)
         │                                     └─→ cancelled
         ├─→ blocked ─┬─→ pending               (unblock)
         │            └─→ cancelled
         └─→ cancelled
```

`completed`, `errored`, and `cancelled` are terminal. A move to the status a task
already holds is on the table, so a repeat write doesn't throw. Anything else
throws an `IllegalTaskTransitionError` carrying `taskId`, `from`, and `to`, and
writes nothing.

**`retryLedger`** records the task's standing against the collection's
`maxTotalRetries` budget:

```ts
task.retryLedger;   // { granted: 2, deniedByBudget: false } | undefined
```

`granted` counts the failure retries this task was **authorized** — written when
`fail()` re-pends the task, so it excludes the re-entries that do not spend the
budget (`unblock`, `resumeFromReview`, `reclaim`) and includes a retry that was
granted but never picked up. It is not derivable from `attempts`, which is a claim
counter. `deniedByBudget` turns `true` once a retry was refused because the
collection's budget was spent; the board's `terminationReason` reads that flag, so
branch on it rather than parsing the error string.

The field is **absent** on a task that has never failed and on any task stored
before it existed, so read it with a single guard — `task.retryLedger?.granted ?? 0`
— and treat absent as zero granted, not denied. Counting starts at the upgrade: a
durable task that had already retried comes back at zero rather than with a
reconstructed history.

### TaskCollection

`getOrCreateTaskCollection` resolves a CAS-safe `TaskCollectionRef` over one of
three backings — request-state (the `taskBoard` default; survives block boundaries
within a request), block-scoped state (per board invocation — `backing: "sequencer"`
is the common case), or resource-collection (outlives the request: a user's queue, an
org work pool — declare one with `defineTaskCollection`). Every mutation that
changes a field emits a `task-change` component item.

**Freshness is scoped to one request.** Every ref resolved over the same collection
inside a request sees the same tasks, so a task added through any of them is
immediately visible through all of them — including a ref a task-board worker
resolved before it went idle. On the resource backing, don't rely on a running
request seeing a write made by another request. A *later* request reads it.

Removals reconcile when you resolve. A task the running request removed (an explicit
`delete` on the resource collection, or a capacity eviction) stops being reported
from the next resolution onward. A ref you are already holding keeps reporting such
a task until it resolves again.

`complete` and `fail` take an optional `TaskTransitionOptions` argument that makes
a write-back advisory — `ifAllowed` skips the write when the state machine rejects
it or the task is already settled, `expectAttempt` skips it when the caller no
longer holds the claim. A guard cannot be raced: the task cannot change between the
check and the write. A declined write is skipped and never throws; the call reports
it on the returned `TaskWriteOutcome`. Omit the argument and both methods throw on
an illegal transition.

`complete`, `fail`, `cancel` and the five field mutators resolve to a
`TaskWriteOutcome`: `recorded` (a field changed and a `task-change` item was
emitted), `unchanged` (the task already held the state asked for, nothing written),
or `declined` with a `reason` (`terminal` / `disallowed` / `lost-claim`, resolved in
that precedence order) and the `status` the task was in when the write was refused.
A decline never throws, and discarding the return value is supported. `cancel` is
advisory with no options to pass: cancelling a settled task declines with reason
`terminal`.

`setAssignee` is the one field mutator that refuses anything — it declines on a
terminal task. `setPriority`, `addLabel`, `removeLabel`, and `patchMetadata` write to
a terminal task, so a post-drain failure audit can label what went wrong; those four
answer only `recorded` or `unchanged` (`patchMetadata` merges rather than compares,
so it answers `recorded` even for a no-op patch). `unchanged` is a statement about
the task record — on a resource backing the write reaches the resource either way,
so a `resource_change` can fire for an `unchanged` write. A missing task throws on
all eight.

```ts
import { getOrCreateTaskCollection } from "@flow-state-dev/orchestration";

const collection = await getOrCreateTaskCollection({ ctx, backing: "request", collectionId: "plan" });
await collection.addTask({ id: "research", goal: "research the topic" });
await collection.addTask({ goal: "draft the post", deps: ["research"] });
```

### Dispatchers

`fifoDispatcher`, `topologicalDispatcher` (the default), `priorityDispatcher`,
`classifierDispatcher({ classify })`, and `eventDispatcher({ topicFor, topic })`. None of
them claims a task whose `deps` aren't all `completed` — that eligibility rule lives
on `collection.claim` — so they differ only in ordering. `fifoDispatcher` and
`topologicalDispatcher` are ordered identically; `priorityDispatcher` takes the
highest `priority` first, ties on `createdAt`.

## Task board

```ts
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
```

`taskBoard({ name, collection, workers, ... })` returns
`{ drain, collectionId, capability, backing, hasIdlessInitialTasks, caps }`.
Mount `board.drain` in a sequencer. `hasIdlessInitialTasks` is `true` when any
`initialTasks` entry omits an `id`; an idless seed re-adds on every drain, which is
why `goalSeekLoop` rejects such a board when `maxIterations > 1`. `workers` is a
single uniform worker or a
`{ [assignee]: block }` registry; each task's `assignee` routes it. Config:
`defaultWorker` (optional fallback for a task whose assignee is unmatched or
omitted — reached only on a miss, declared workers untouched),
`concurrency` (default 4), `dispatcher` (default `"topological"`),
`onIdle` (`"complete-or-blocked"` default | `"complete"` | `"wait"`), `initialTasks`,
`onError`, `maxIterations` (per-worker claim-loop cap, default 10000), the two creation caps
`maxEnqueuedTasks` (default 100 — tasks addable while others are `pending`,
refreshes on drain) and `maxTotalTasks` (default 500 — lifetime count incl.
terminal, never refunded), and the retry budget `maxTotalRetries` (default 50 —
failure retries the board may authorize across every task). The creation caps take a
positive integer or `null` (explicitly unbounded); `maxTotalRetries` takes a
**nonnegative** integer or `null`, so `0` means "run every task once, never retry".
Omission reapplies the default on all three. They apply only when the board
constructs its own collection — a supplied `collection` is left alone and passing
any of them is a construction error, so configure caps on
`getOrCreateTaskCollection`'s sequencer/request backing instead. Per-task retries
are set via `maxAttempts` on each task (`TaskInit`), not on the board. At the retry
budget the failing task settles terminal `errored` and the board's completion item
reports `terminationReason: "retry-budget-exhausted"` alongside `counts.retries` and
the limit in force. See the
[Task board guide](https://flow-state.dev/docs/orchestration/task-board).

### goalSeekLoop

```ts
import { goalSeekLoop } from "@flow-state-dev/orchestration/task-board";
```

`goalSeekLoop({ name, board, seed?, judge, maxIterations, finalize?, ... })` wraps a
board's drain in an outer, judge-gated loop: seed → drain → judge → (replan) →
repeat → finalize. The `judge` returns a three-way `Verdict`
(`done`/`continue`/`replan`); `maxIterations` is a mandatory finite backstop, and
the loop lands with a typed `goal-seek-loop-termination` item rather than hanging.
The board must be request- or resource-backed. `parallelTasks` and `planAndExecute`
are expressed on it. See the [GoalSeekLoop guide](https://flow-state.dev/docs/orchestration/goal-seek-loop).

## Skills and delegation

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

A skill that declares an `agents:` field turns on **delegation** (or force it on
with `delegation: true` even with no `agents:`). An agent is a prompt-driven
teammate — defined inline (`prompt` / `prompt-ref`) inside the skill, or referenced
from the registry (`agent-ref`).

Every delegation board also gets an on-demand **default worker**: it materializes on
demand and runs any task whose assignee is unset, so a task with no named agent still
runs, and an empty roster still delegates.

Every tool that writes an `assignee` checks it: `addTask`, `assignTask`,
and `updateTask` reject a name that isn't one of the declared agents, returning the
available agents so the caller can correct it, instead of letting a mistyped name
fall through to the default worker at drain time. A board with no declared agents
has no roster to check and accepts any assignee.

Binding the skill installs a private
task board (own-state, scoped to that generator), the eight `taskTools` (`addTask`,
`assignTask`, `completeTask`, `failTask`, `blockTask`, `cancelTask`, `updateTask`,
`listTasks`), `runBoard`, and a guidance context. The generator orchestrates by
planning a graph with `addTask` (assignee, deps, structured input) and calling
`runBoard` once: the board drains under concurrency with dependency gating and
returns every task's output. There is no per-agent tool the generator calls
directly; draining the board is the sole execution path. Agents materialize at
runtime, so `agent-ref` agents resolve through the library's
`agentRegistry`/`materializeAgent` options and runtime-activated skills contribute
their tools too. With no delegation board resolvable, a stray `taskTools` call
returns `{ ok: false, error: "no_delegation_board" }` rather than throwing.

The board is bounded by default: `addTask` is refused past 100 tasks enqueued at once
(`{ ok: false, error: "enqueued_task_cap_exceeded" }` — drain with `runBoard` to
free slots, though tasks stranded behind a failed dep stay `pending` and hold
theirs) or 500 over the board's lifetime (`total_task_cap_exceeded`, never
refunded by draining), tunable via `createSkillsLibrary`'s `maxEnqueuedTasks` /
`maxTotalTasks` (`null` = unbounded). It carries no retry budget: a task created
through the delegation `addTask` tool takes no `maxAttempts`, so it runs once and
never retries.

> **Which surfaces are capped.** The caps come from the code that CONSTRUCTS the
> collection, so they cover boards the skills library installs and boards
> `taskBoard` builds itself — not the capability surface on its own. Wiring the
> exported `taskTools` singleton by hand (`uses: [taskTools]`) resolves the host
> generator's own-state board through a bare, **uncapped** collection: `addTask`
> there is unbounded. For a bounded board on that path, build the
> collection yourself with
> `getOrCreateTaskCollection({ …, maxTotalTasks, maxEnqueuedTasks })` and hand a
> resolver for it to `createTaskToolsCapability(resolver)`. That resolver must
> target the host generator's own state via `ctx.parent` (each tool runs as a
> child block, so `ctx.sequencer` is the wrong container) and name the board's
> `stateKey` — see
> [Delegation](https://flow-state.dev/docs/skills/delegation#board-and-overrides)
> for the full recipe.

**Every `taskTools` call reports a problem the same way.** A status change the
task's current status does not permit is a recoverable tool result too, not a
throw: `completeTask` on a task that was never started answers
`{ ok: false, error: "illegal_status_transition: …" }`, naming the task's current
status and the calls actually available from it. So the recoverable set across
the eight tools is `no_delegation_board`, `task_not_found`, `unknown_assignee`,
`enqueued_task_cap_exceeded`, `total_task_cap_exceeded`,
`illegal_status_transition`, and `terminal_task_write_declined` — a coordinator
rule like "when a tool returns `ok: false`, re-plan" covers all of them.

Match those by **prefix, not equality**. `no_delegation_board`, `task_not_found`,
`enqueued_task_cap_exceeded`, and `total_task_cap_exceeded` are the whole `error`
string, but `unknown_assignee`, `illegal_status_transition`, and
`terminal_task_write_declined` are followed by `: ` and a sentence of guidance for
the model, so `error === "illegal_status_transition"` never matches. Use
`error.startsWith("illegal_status_transition")`. There is no separate structured
`code` field today.

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

At the delegation `taskTools` boundary a `declined` verdict **does** become a tool
result: `assignTask`, `cancelTask`, and an `updateTask` carrying an assignee answer
`{ ok: false, error: "terminal_task_write_declined: …" }` on a finished task rather
than reporting a success that did not happen. `ok: true` from those tools means "the
backing reported no decline", not "the write happened" — for the two built-in
backings those coincide, but a custom ref that reports nothing is carried past
rather than having a verdict synthesized for it.

```ts
// "research-lead" declares agents: → delegation installs automatically.
generator({ uses: [skills.with({ active: ["research-lead"] })] });
```

An inline agent may set `context-supply: conversation` to inherit the parent
conversation up to the point it is dispatched (fork-like), bounded to the last 8
whole turns (a turn count, not a token budget), while its own steps
stay out of the host's history (output keeps `history: false`). Omitting the
field is the default: the agent is isolated and sees only its task input — there
is no `isolated` value to set. It applies to `prompt` / `prompt-ref` agents;
setting it on an `agent-ref` agent fails loud. See
[Context supply](https://flow-state.dev/docs/orchestration/context-supply).

For a graph fixed in code (seeded `initialTasks`, custom collection, tuned
dispatcher), put a `taskBoard(...).drain` or a `goalSeekLoop` in the generator's
`tools:` — any block can be a tool, and only the finalized result re-enters the
caller's history.

See [Per-generator binding](https://flow-state.dev/docs/skills/binding) for the
`active` / `allowed` / `activeState` surface and
[Delegation](https://flow-state.dev/docs/skills/delegation) for the `agents:` shape.

## Documentation

- [Authoring a delegating skill](https://flow-state.dev/guides/agents-command-the-board)
- [Orchestration overview](https://flow-state.dev/docs/orchestration/overview)
- [Task substrate](https://flow-state.dev/docs/orchestration/task-substrate)
- [Task board](https://flow-state.dev/docs/orchestration/task-board)
- [Flow policy](https://flow-state.dev/docs/orchestration/flow-policy)
- [Skills](https://flow-state.dev/docs/skills/overview)

## Running tests

```bash
pnpm --filter @flow-state-dev/orchestration test
```
