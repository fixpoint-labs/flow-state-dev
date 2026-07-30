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
2. **`board.drain`** — the drain. A normal block you mount in a flow. When it
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

// board.drain  → the drain (a block you mount)
// the collection lives at the backing you chose ("queue" on the request)
```

Keep those two separate in your head and everything else follows. The
collection can hold tasks that nobody has processed yet. `board.drain` is the
only thing that processes them.

## When does the drain run?

**Only while `board.drain` is executing inside a request.** Not before it's
mounted, not after it finishes, not on a timer. If no block is draining, tasks
just sit in the collection at whatever status they're in.

The example makes this concrete with two actions over the same collection. The
first seeds tasks and reads them back **without** draining:

```ts
const seedAndInspect = sequencer({ name: "seed-and-inspect" })
  .tap(seedTasks)     // add tasks to the collection
  .step(readResults); // read them back — no board.drain here
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
  .step(board.drain) // the drain
  .step(readResults);
```

```bash
pnpm fsdev run board-lifecycle seedDrainRead -i '{"items":["alpha","beta"]}'
# → tasks: [{ id: "task-0", status: "completed", result: "ALPHA" }, … ]
```

Same seeding. The only difference is that `board.drain` ran, and that's what
moved every task from `pending` to `completed`. That is the entire lifecycle in
one contrast.

Under the hood, the drain is a loop: idle workers wait for a task to become
claimable, wake when one does, run it, and repeat until the board is idle. That
loop lives inside `board.drain`'s execution. When the block returns, the loop
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
| `request` (default) | the whole request | most work: a seed/read block outside `board.drain` shares the collection, or an outer loop re-enters `board.drain` to drain freshly added tasks — and it works when `collection` is omitted entirely |
| `sequencer` | the `board.drain` sequencer's own invocation | you specifically want per-invocation isolation: the board seeds, drains, and is read within one block slot and two calls should not share state. Opt in with `{ backing: "sequencer", collectionId }` |
| `resource` (scope `session`/`user`/`org`) | across requests | the tasks are a durable queue or list that must outlive the request that created them |

The default is `request`, and that's usually right — a block outside the drain
(or a later drain in a replan loop) can see the same tasks. Opt into `sequencer`
only when you want each `board.drain` call to get its own isolated collection —
note that omitting `backing` no longer gives you that; you have to ask for it.
Reach for `resource` when the tasks themselves are the durable thing.

**Multiple boards, one request.** Nothing stops you running several boards in
the same request or sequencer. Each board is keyed by its own `collectionId`
(the request backing namespaces its state by it), and each board's `name` must
be unique in the flow. Two boards with different `collectionId`s never see each
other's tasks, so a flow can drain, say, a "research" board and a "review" board
independently.

## Living across requests as a resource

Here's the part that trips people up. A durable collection persists its tasks in
the resource graph, scoped to a session, user, or org. Declare it with
`defineTaskCollection` and pass it straight to the board:

```ts
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";

const todos = defineTaskCollection({
  id: "todos",             // stable id — the resource pattern and the board's collectionId
  scope: "user",           // ← the collection's lifetime
  stateSchema: z.object({ topic: z.string() }), // the task `input` payload
});

const board = taskBoard({
  name: "todo-board",
  collection: todos,
  workers: { processor },
});
```

The board registers the collection on both its drain and `board.capability`, so a
sibling action that lists `board.capability` in `uses` reads and writes the same
durable tasks — including while the board is mid-drain, covered in
[Handles inside one request share a task set](#handles-inside-one-request-share-a-task-set)
below. Two things to keep in mind:

- **The scope lives on the collection, not the board.** `session` / `user` / `org`
  is set once on `defineTaskCollection`; the board just points at it.
- **For an externally-managed store**, `collection` also accepts a
  `(ctx) => TaskCollectionRef` factory — resolve any `ResourceCollectionRef`
  yourself inside it. `defineTaskCollection` is the one-liner for the common case.

So request A can `addTask` into it, the request ends, and request B — a
different call, even a different session turn — can still see those tasks (same
`user`). The **state** genuinely outlives the request.

What that does **not** give you is background processing. The tasks persisting
does not mean anything is draining them. There is no worker sitting behind the
collection pulling tasks off it. Processing still only happens the way it always
does: when some request mounts a board over that collection and runs
`board.drain`. So the shape of a durable board is:

- Request A adds tasks to the resource-backed collection (maybe it drains them,
  maybe it just enqueues and returns).
- Between requests, the tasks sit there at whatever status they reached. Pending
  tasks stay pending. Nothing is working on them.
- Request B runs a drain over the same collection and processes what's pending.

"A board that lives across requests" is really "task state that lives across
requests, drained by whatever request next runs the board." The durability is
in the state, not in a running process.

### Handles inside one request share a task set

Reads through a resource handle are synchronous, which means the handle has to
keep its own record of which tasks exist rather than querying the store on every
`list()`. Every handle resolved over the same collection **inside one request**
shares that record, so an add through one handle is visible through all of them,
right away.

```ts
// Block A resolves a handle and adds two tasks.
const a = await getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: "todos", collection: todoTasks });
await a.addTask({ id: "t1", goal: "…" });
await a.addTask({ id: "t2", goal: "…" });

// Block B, later in the same request, resolves its OWN handle and adds a third.
const b = await getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: "todos", collection: todoTasks });
await b.addTask({ id: "t3", goal: "…" });

a.list(); // → [t1, t2, t3]  — same request, so a sees b's add
b.list(); // → [t1, t2, t3]
```

That's what makes a mid-drain add work: a worker resolves its handle when it
goes idle and holds it while it waits, so a sibling's add has to reach that
handle to wake it.

Two boundaries are worth knowing:

- **A different request does not share the record**, and resolving again will not
  bridge them. A request reads durable state into memory when it starts, so a
  drain already under way never sees another request's write, no matter how many
  times it resolves the collection. A *future* request reads it. Sequential
  access across requests is the normal case and works exactly this way.
- **Removals reconcile when you resolve, not continuously.** A task collection
  has no `delete`, but the resource collection underneath it does, and a
  capacity limit can evict one. Removals made *by your own request* do reach a
  later resolution, because they go through the same in-memory state the reads
  do. A handle you are already holding keeps reporting a removed task until
  something resolves the collection again, which reconciles the shared record in
  both directions.

## What a board is not

A board is not a background job queue. The drain needs an active request to run
in; there's no primitive that wakes a standing worker when a task is inserted by
*another request*, and the durable-work-pool case — a foreground request
appending tasks while a separate background process drains the same board — is
not supported today. If you need work to run outside the request that created
it, dispatch a fresh flow run (see [Background jobs](./background-jobs-bullmq))
that constructs and drains its own board; that's a new request with its own
drain, not a shared board with a separate drainer.

## Related

- [Building a research team](./building-a-research-team) — a board from scratch, three ways.
- [Create your own pattern](./create-your-own-pattern) — wrap `taskBoard` in a reusable factory.
- [Authoring a delegating skill](./agents-command-the-board) — let a model add and assign tasks mid-drain.
- [Task board](/docs/orchestration/task-board) and [Task substrate](/docs/orchestration/task-substrate) — the reference docs.
