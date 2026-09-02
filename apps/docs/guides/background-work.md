---
title: Work that outlives the turn
sidebar_label: Work that outlives the turn
description: "What background work means in flow-state-dev: side chains, queue-backed action runs, and child sessions, what each one outlives, and which page documents it."
---

# Work that outlives the turn

The usual shape of a flow is short. A request arrives, blocks run, items stream back, the response closes. Everything the caller waits for happens inside that window.

Plenty of useful work doesn't fit in it. A memory write that shouldn't slow the reply down. An hour-long analysis no browser will hold a connection for. A research pass a coordinator kicked off and intends to collect later.

There's more than one place for that work to go, and background work is the name all of them go by. They're different mechanisms with different guarantees, so this page is the map: what each one outlives, when you'd reach for it, and where its reference lives.

## What separates them

Each mechanism outlives something different, and that is the whole distinction.

| | Runs in | Outlives | Its own session? |
|---|---|---|---|
| **Side chain** | the request that dispatched it | the sequencer, not the request | no |
| **Queue-backed action run** | a worker process | the web process that accepted it | no, same request id |
| **Child session** | a session of its own, under the conversation | the request that started it | yes |

If you can answer "what still has to be alive when this finishes", you've picked one.

## Side chains: alongside the turn

Inside a sequencer, `.sideChain()` queues a block to run next to the chain instead of in it.

```ts
import { sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const turn = sequencer({
  name: "turn",
  inputSchema: z.object({ message: z.string() }),
})
  .step(respondToUser)
  .sideChain(captureMemory);
```

`respondToUser` streams to the browser and the chain moves straight on. `captureMemory` runs alongside it. On a run that finishes normally the request waits: every queued task settles before the stream closes. Closing the tab doesn't cancel that work — background tasks don't listen to the transport signal — but nothing waits for it either, so a process that shuts down first can still drop it. An explicit abort does cancel it. A failure is logged rather than surfaced, which is the trade you take for not blocking.

Reach for it when the work is cheap, best-effort, and belongs to the turn that produced it. Analytics, cache warming, memory writes, auto-titling.

Read next: **[Side chains](/docs/advanced/sequencer-side-chains)** for `.sideChainIf()`, `.forEachSideChain()`, the `.waitForSideChain()` barrier, and why a background task sees a different abort signal than the foreground chain.

## Queue-backed action runs: the same request, somewhere else

Hand `createFlowState` a worker adapter and actions stop running inline. They become queued jobs.

```ts
import { createFlowState } from "@flow-state-dev/engine";
import { bullmqWorker } from "@flow-state-dev/bullmq";

export const flowstate = createFlowState({
  flows: { billing },
  stores: { /* a backend the web process and the workers both reach */ },
  worker: bullmqWorker({ connection: process.env.REDIS_URL! }),
});
```

A POST to an action now returns a request id instead of running the action. A worker picks the job up, runs it against the same stores, and the client attaches to `GET /requests/:id/stream` exactly as it would for an in-process run. Same request, same session. A worker that dies mid-action retries the job.

The configuration above runs in `colocated` mode, the default: one process both accepts jobs and consumes them, so you get the queue's durability and its retries without deploying anything new. Separating the tiers is a mode flag rather than a rewrite — `dispatch-only` on the web process, `worker-only` on a dedicated worker that calls `flowstate.ready()` to start consuming. A `worker-only` process only consumes: it installs no dispatcher, so an action that reaches a router in that process runs inline instead of becoming a job. Keep the router on the dispatching tier.

Reach for it when the run is long or heavy enough that you don't want it on the web tier at all, or when you want to scale workers separately.

Read next: **[Background jobs with BullMQ](/guides/background-jobs-bullmq)** for the setup, from Docker to separated worker containers, and **[Host adapters](/docs/server/host-adapters)** for where this sits among the deployment shapes.

## Child sessions: a job with its own session

A child session is background work that runs in a session of its own, hanging off the conversation that started it. Its runs don't show up in the parent session's request list. You reach them by asking the parent conversation for its children, then opening one.

```ts
import { createSessionClient } from "@flow-state-dev/client";

const sessions = createSessionClient();

const children = await sessions.listChildSessions("sess_abc");
const first = children[0];
const runs = first === undefined ? [] : await sessions.listSessionRequests(first.id);
```

A child session's `id` is a session id, so every session read works on it, and a child that dispatches work of its own has children too.

Having its own session is also what it costs you. A child session keeps its own state, its own history, and its own session-scoped resources, and none of those are the parent conversation's. What the two share without asking is the user: user- and org-scoped data is the same data on both sides, because a child session runs as the same user on the same flow.

For anything narrower, hand it over as input when the work starts and report it back when the work finishes. A session-scoped resource has a second route: mark it `sharedToLineage` and the conversation and every child session under it resolve one copy of it. Session state has no such route; it is private to each session either way. See [State vs Resources](/docs/resources/storage#session-scope-and-background-work).

A child session is started from the flow, by a `dispatcher()` block or by a task-board seat.

### With a `dispatcher()` block

A dispatcher sends a dispatch to one of the flow's `internal` entries, which are reachable this way and never from a caller. `session: { key }` runs the dispatch in a child derived from the key; `session: { id }` delivers it into a session that already exists.

```ts
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { z } from "zod";

const investigate = handler({
  name: "investigate",
  inputSchema: z.object({ company: z.string() }),
  execute: async (input, ctx) => {
    // Runs in the child session, on a request of its own.
    ctx.emit.status(`Investigating ${input.company}`);
  },
});

const investigateInBackground = dispatcher({
  name: "investigate-in-background",
  type: "internal",
  target: "investigate",
  inputSchema: z.object({ company: z.string() }),
  session: { key: (input) => input.company }, // one child per company
});

export default defineFlow({
  kind: "diligence",
  actions: { start: { block: investigateInBackground } },
  internal: { investigate: { block: investigate } },
})();
```

The dispatcher returns `{ sessionId, requestId, adopted }` as soon as the runtime has accepted the request. The same key from the same conversation lands on the same child, with `adopted: true`, so a retry re-enters the work it started. Every option and refusal is on [Flow options > Dispatching to another session](/docs/configuration/flow#dispatching-to-another-session).

### With a task board

A board is a list of tasks plus a set of named workers that claim them. Put a `dispatcher({ type: "task" })` in one of those seats instead of a worker, and the seat's tasks run in a child session instead of the request that claimed them. The block that runs there is declared on the flow, under `tasks`, at the name the dispatcher's `target` gives:

```ts
import { defineFlow, dispatcher } from "@flow-state-dev/core";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { defineTaskCollection, type TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";

const diligenceTasks = defineTaskCollection({ id: "diligence-tasks", scope: "user" });

const board = taskBoard({
  name: "diligence",
  boardId: "diligence",
  collection: diligenceTasks,
  workers: {
    investigate: dispatcher({
      name: "hand-off-investigate",
      type: "task",
      target: "investigate",
      // Rows on the same topic share one child and continue its history.
      session: {
        key: (task: TaskWorkerInput) =>
          typeof task.metadata?.topic === "string" ? task.metadata.topic : task.taskId,
      },
    }),
    verify: dispatcher({
      name: "hand-off-verify",
      type: "task",
      target: "verify",
      session: "per-task",
    }),
    summarize: summarizeBlock, // a bare block runs inline, in the request that claimed the task
  },
  initialTasks: [
    { id: "filings", goal: "Read the Q3 filings", assignee: "investigate", metadata: { topic: "acme" } },
    { id: "calls", goal: "Summarize the analyst calls", assignee: "investigate", metadata: { topic: "acme" } },
  ],
});

export default defineFlow({
  kind: "diligence",
  actions: { start: { block: board.drain } },
  tasks: {
    investigate: { block: investigateBlock }, // what runs in the child session
    verify: { block: verifyBlock },
  },
})();
```

The `tasks` map is what makes the hand-off legal. Each seat's `target` names an entry in it, and the flow refuses to build if a hand-off is reachable and its entry isn't declared, or if an entry is declared that no board hands off to. `boardId` is required once any seat hands off, and the collection has to be a `defineTaskCollection()`: the child settles its task after the request that claimed it is gone, so the collection it settles against has to outlive that request too. The board checks its part when it is built and the flow checks the rest when it is defined, not when the first task arrives. See [Task board > Handing tasks off to child sessions](/docs/orchestration/task-board#handing-tasks-off-to-child-sessions).

Tasks are seeded here to keep the example in one piece. A task added later with `addTask` carries the same `assignee` and `metadata` fields.

Some bounds are worth knowing before you reach for this.

**The board has to be reachable from the child session.** The child settles its own task, and resource scope resolves against whichever session is running — so a session-scoped board hydrates empty inside a child session and has nothing to settle. Give the collection `sharedToLineage: true` and the whole lineage settles against one ledger. `user` and `org` scope need nothing extra.

**On serverless, the work is bounded by the function unless something else consumes the queue.** Detached work runs inside the invocation that started it, so the function's maximum duration is the ceiling. A queue adapter alone does not lift it: in `colocated` mode the same process both enqueues *and* consumes, so the job is picked up by the invocation that is already running out of time. What lifts the ceiling is a consumer with its own lifetime — run the function in `dispatch-only` mode and host the worker separately, as a container or a long-lived process in `worker-only` mode. `colocated` is the right answer on a server you keep running, not on a function.

**A `worker-only` process starts child sessions that aren't durable.** That mode dispatches nothing, so the work runs in the worker process and nothing re-runs it if that process stops. See [From a worker-only process](/docs/cli/overview#from-a-worker-only-process).

**A child session releases the request while it is actually working the task.** A task a child has in hand is not counted by the board that filed it, so the request that filed it finishes without waiting.

That release lasts only while the child is actually holding the task, not for the rest of the task's life. Handing work over says where it belongs; it does not promise the work is still moving. If the child stops without settling the task — its process dies, its host is shut down — the task goes back to being the board's to deal with, and the next drain of that board waits on it like any other outstanding work. A task parked for a person counts again too, unless the board asked not to wait on reviews with [`onReview: "exit"`](/docs/orchestration/task-board#waiting-on-a-person-onreview).

### Which tasks share a child session

The seat's dispatcher has a `session` policy, and it decides:

| `session` | Child session |
|---|---|
| `"per-task"` | One per row. |
| `"per-worker"` | One per seat, shared by every row the seat runs. |
| `{ key: (task: TaskWorkerInput) => string }` | Rows whose function returns the same key share one child. The function reads the same task input the worker receives. |

The two presets include the board id in the key, so two boards' children stay apart even when their task ids coincide. A custom key is used as returned, so two seats, or two boards, that return the same key share one child. The key is what tells one conversation's children apart, so an `internal` dispatcher and a seat that compute the same key from the same conversation land on the same child as well.

Above, `filings` and `calls` both carry `topic: "acme"`, so they run in one child session: two runs in the same session, and `listSessionRequests` on that child returns both. A row with no topic falls back to its own task id in that key function, so a task that doesn't ask for continuity gets a child of its own. Set a topic when a worker should pick up where it left off on the same body of work: one research thread, one issue, one document. Leave it off when each task starts cold. A key function that returns an empty string fails the row.

A child that runs several rows runs them under its entry's concurrency policy. An entry a `per-worker` or `key` seat hands off to defaults to `queue`, so the rows run one at a time. A `per-task` seat's entry keeps the ordinary default (the flow's `request.concurrency`, else `allow`). An explicit `concurrency` on the entry wins:

```ts
tasks: { investigate: { block: investigateBlock, concurrency: "allow" } },  // let rows in one child interleave
```

Starting a child session is server-side only. There's no client call for it.

You can exercise all of it from the terminal by running the flow against an `fsdev.config.*`. Whether the command waits for the background work before exiting depends on whether a queue is configured, and running without a config can't start it at all. See [Background work from the CLI](/docs/cli/overview#background-work).

Read next: **[Detached work](/docs/server/background-work)** for the HTTP surface, its paging, what `status` does and doesn't tell you, and the access rules the listing endpoint applies; **[Client overview](/docs/client/overview#background-work)** for reading it from an app; and **[Durable execution](/docs/advanced/durable-execution)** for what happens to a run that was interrupted.

## Nearby, and often confused

**A durable task collection is not a queue with a drainer behind it.** Declaring a collection with `defineTaskCollection` makes the task *state* survive across requests. Nothing pulls tasks off it on its own. They sit at whatever status they reached until some request mounts a board over the collection and drains it. See [The board lifecycle](/guides/board-lifecycle).

**A scheduled action is a fresh run with no caller**, not the continuation of an earlier one. A cron fires the action, the framework builds a request for it, and the same streaming and recovery machinery applies. See [Scheduled actions](/docs/server/scheduled).

## Watching any of it

Whichever path the work takes, the thing you observe is a request — for a side chain, the request it runs inside; for the other two, one of their own. Every run has an id, a lifecycle status, and an item log, and the same tools read all three.

- Attach live with `GET /api/flows/:kind/requests/:requestId/stream`. See [Streaming](/docs/streaming/overview).
- Read a session's runs with `listSessionRequests`, and a conversation's children with `listChildSessions`. See [Client API](/docs/api/client).
- Reconnect and resume from a sequence number rather than replaying from zero. See [Connection resilience](/docs/server/connection-resilience).
- Inspect any of it block by block in the [DevTool](/docs/devtool/overview).
