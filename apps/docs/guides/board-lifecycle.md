---
title: The board lifecycle
sidebar_label: Board lifecycle
description: What a task board actually is — durable task state plus a drain — when the drain runs, how a collection is shared across blocks, and what "living across requests" does and doesn't buy you.
---

# The board lifecycle

The task board is easy to use and easy to get a wrong mental model of. The
confusion is almost always the same: people think of "the board" as one
running thing, when it's really **two** things with different lifetimes. Once
you separate them, when a board runs — and when it doesn't — stops being
mysterious.

This guide has a runnable companion:
[`examples/guides/board-lifecycle`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/examples/guides/board-lifecycle).
Its two actions seed the same collection identically and differ only in whether
the drain runs — you can watch the difference from the CLI.

## A board is two things

`taskBoard(config)` gives you a handle with two parts:

1. **A task collection** — the durable state. A `Record<id, Task>`: each task's
   goal, status, assignee, input, and (once it runs) output. This is just data
   sitting in a state store.
2. **`board.block`** — the drain. A normal block you mount in a flow. When it
   runs, it claims pending tasks, hands each to its worker, and moves the task
   from `pending` to `completed` (or `errored`). When there's nothing left to
   do, it stops.

```ts
const board = taskBoard({
  name: "queue-board",
  collection: { backing: "request", collectionId: "queue" },
  workers: { processor },
  initialTasks: [],
});

// board.block  → the drain (a block you mount)
// the collection lives at the backing you chose ("queue" on the request)
```

Keep those two separate in your head and everything else follows. The
collection can hold tasks that nobody has processed yet. `board.block` is the
only thing that processes them.

## When does the drain run?

**Only while `board.block` is executing inside a request.** Not before it's
mounted, not after it finishes, not on a timer. If no block is draining, tasks
just sit in the collection at whatever status they're in.

The example makes this concrete with two actions over the same collection. The
first seeds tasks and reads them back **without** draining:

```ts
const seedAndInspect = sequencer({ name: "seed-and-inspect" })
  .tap(seedTasks)     // add tasks to the collection
  .step(readResults); // read them back — no board.block here
```

```bash
# Run from the example directory — fsdev config discovery is cwd-only.
cd examples/guides/board-lifecycle
pnpm fsdev run board-lifecycle seedAndInspect -i '{"items":["alpha","beta"]}'
# → tasks: [{ id: "task-0", status: "pending", result: null }, … ]
```

The tasks exist. Nothing ran them. Now add the drain in the middle:

```ts
const seedDrainRead = sequencer({ name: "seed-drain-read" })
  .tap(seedTasks)
  .step(board.block) // the drain
  .step(readResults);
```

```bash
pnpm fsdev run board-lifecycle seedDrainRead -i '{"items":["alpha","beta"]}'
# → tasks: [{ id: "task-0", status: "completed", result: "ALPHA" }, … ]
```

Same seeding. The only difference is that `board.block` ran, and that's what
moved every task from `pending` to `completed`. That is the entire lifecycle in
one contrast.

Under the hood, the drain is a loop: idle workers wait for a task to become
claimable, wake when one does, run it, and repeat until the board is idle. That
loop lives inside `board.block`'s execution. When the block returns, the loop
is gone — even if you add more tasks to the collection afterward, nothing
processes them until a drain runs again.

## Sharing one collection across blocks

Notice that three different blocks in `seedDrainRead` — the seeder, the drain,
and the reader — all worked with the same collection. That's because the
collection is addressed by id, and any block can resolve it:

```ts
const collection = await getOrCreateTaskCollection({
  ctx,
  backing: "request",
  collectionId: "queue",
});

await collection.addTask({ id: "task-0", goal: "…", assignee: "processor", input });
collection.list({ status: "completed" }); // synchronous read
```

`getOrCreateTaskCollection` doesn't allocate storage — it resolves a handle to
state that already exists at the chosen backing. So the block that seeds and the
block that reads don't need to be the same block, or even know about each other.
They only need the same `backing` and `collectionId`.

This is what "work with a board across blocks" means: the board's drain is one
participant, but a seed block before it and a reader after it are just as much
part of the flow. The board doesn't have to be a black box that runs to
completion in its own slot — you can put tasks in before it, and read results
out after it, from ordinary blocks.

## Backings set the lifetime

The collection's **backing** decides how long the task state lives. This is the
lever for "when is the board's state still around":

| Backing | Lives for | Reach for it when |
|---------|-----------|-------------------|
| `sequencer` (default) | the `board.block` sequencer's own invocation | the board seeds, drains, and is read within one block slot — the common "fan out and gather" case |
| `request` | the whole request | a seed/read block outside `board.block` shares the collection, or an outer loop re-enters `board.block` to drain freshly added tasks |
| `resource` (scope `session`/`user`/`org`) | across requests | the tasks are a durable queue or list that must outlive the request that created them |

The default is the tightest lifetime, and that's usually right — a board that
fans out and gathers inside one action doesn't need its tasks to survive the
action. Reach for `request` when a block outside the drain needs the same
collection (the example uses `request` for exactly this). Reach for `resource`
when the tasks themselves are the durable thing.

**Multiple boards, one request.** Nothing stops you running several boards in
the same request or sequencer. Each board is keyed by its own `collectionId`
(the request backing namespaces its state by it), and each board's `name` must
be unique in the flow. Two boards with different `collectionId`s never see each
other's tasks, so a flow can drain, say, a "research" board and a "review" board
independently.

## Living across requests as a resource

Here's the part that trips people up. A `resource`-backed collection persists
its tasks in the resource graph, scoped to a session, user, or org:

```ts
const board = taskBoard({
  name: "todo-board",
  // A caller-supplied factory resolves a resource-backed collection.
  collection: (ctx) =>
    getOrCreateTaskCollection({
      ctx,
      backing: "resource",
      collectionId: "todos",  // stable id — also used for task-change event attribution
      collection: todoTasks,  // a ResourceCollectionRef declared on the flow
    }),
  workers: { processor },
});
```

Two things differ from the request example above, and both trip people up:

- **Resource backing goes through a factory**, not a config object. `taskBoard`'s
  `collection` accepts a `{ backing: "sequencer" | "request", … }` object *or* a
  `(ctx) => collection` factory. There's no `{ backing: "resource" }` object form,
  because resource backing needs a `ResourceCollectionRef` you resolve inside the
  factory. (That asymmetry is a rough edge, not a deep reason — a config form
  could exist.)
- **The scope isn't set in the `taskBoard` call.** `session` / `user` / `org`
  lives on the `ResourceCollectionRef` where you declare it:

  ```ts
  // declared once on the flow — the scope is here, not in the board config
  const todoTasks = defineResourceCollection({
    pattern: "todos/**",
    scope: "user",           // ← the collection's scope
    stateSchema: taskStateSchema,
  });
  ```

So request A can `addTask` into it, the request ends, and request B — a
different call, even a different session turn — can still see those tasks (same
`user`). The **state** genuinely outlives the request.

What that does **not** give you is background processing. The tasks persisting
does not mean anything is draining them. There is no worker sitting behind the
collection pulling tasks off it. Processing still only happens the way it always
does: when some request mounts a board over that collection and runs
`board.block`. So the shape of a durable board is:

- Request A adds tasks to the resource-backed collection (maybe it drains them,
  maybe it just enqueues and returns).
- Between requests, the tasks sit there at whatever status they reached. Pending
  tasks stay pending. Nothing is working on them.
- Request B runs a drain over the same collection and processes what's pending.

"A board that lives across requests" is really "task state that lives across
requests, drained by whatever request next runs the board." The durability is
in the state, not in a running process.

### A gotcha: a resource handle knows a fixed set of tasks

To keep reads synchronous, `getOrCreateTaskCollection` takes a one-time snapshot
of *which tasks exist* when you resolve the handle, then tracks that set. Reads
through the handle stay live for those tasks — if a task's status changes, your
`list()` sees the new status. And tasks *you* add through the handle join its
set. But a task inserted through a **different** handle, after yours was
resolved, won't appear in your `list()`.

```ts
// Block A resolves a handle and adds two tasks.
const a = await getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: "todos", collection: todoTasks });
await a.addTask({ id: "t1", goal: "…" });
await a.addTask({ id: "t2", goal: "…" });

// Block B, later, resolves its OWN handle and adds a third through it.
const b = await getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: "todos", collection: todoTasks });
await b.addTask({ id: "t3", goal: "…" });

a.list(); // → [t1, t2]      — a added these; it never learned about t3
b.list(); // → [t1, t2, t3]  — b snapshotted [t1, t2] at resolve, then added t3 itself
```

Within one request's "seed, then drain, then read", this never bites: the seed,
the drain, and the reader run under the same flow and the drain adds tasks
through its own handle. It matters when two independently-resolved handles are
live at once, or across requests — resolve a **fresh** handle when you need to
see additions made elsewhere.

## What a board is not

A board is not a background job queue. The drain needs an active request to run
in; there's no primitive that wakes a standing worker when a task is inserted
from somewhere else, and the durable-work-pool case — a foreground request
appending tasks while a separate background process drains the same board — is
not supported today. If you need work to run outside the request that created
it, dispatch a fresh flow run (see [Background jobs](./background-jobs-bullmq))
that constructs and drains its own board; that's a new request with its own
drain, not a shared board with a separate drainer.

## Related

- [Building a research team](./building-a-research-team) — a board from scratch, three ways.
- [Create your own pattern](./create-your-own-pattern) — wrap `taskBoard` in a reusable factory.
- [Agents that command the board](./agents-command-the-board) — let a model add and assign tasks mid-drain.
- [Task board](/docs/orchestration/task-board) and [Task substrate](/docs/orchestration/task-substrate) — the reference docs.
