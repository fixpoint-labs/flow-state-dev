---
title: Work that outlives the turn
sidebar_label: Work that outlives the turn
description: "What background work means in flow-state-dev: side chains, queue-backed action runs, and dispatched child sessions, what each one outlives, and which page documents it."
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
| **Dispatch** | a child session | the request that started it | yes |

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

## Dispatch: work in a child session

A **dispatch** sends one unit of work to an entry the flow declares, and it runs in a session of its own, hanging off the conversation that started it. Its runs don't show up in the parent session's request list. You reach them by asking the parent what work belongs to it, then opening one.

```ts
import { createSessionClient } from "@flow-state-dev/client";

const sessions = createSessionClient();

const children = await sessions.listChildSessions("sess_abc");
const first = children[0];
const runs = first === undefined ? [] : await sessions.listSessionRequests(first.id);
```

A child's `id` is a session id, so every session read works on it, and a child that dispatches work of its own has children too.

Having its own session is also what it costs you. The child keeps its own state, its own history, and its own session-scoped resources, and none of those are the parent conversation's. What the two share without asking is the user: user- and org-scoped data is the same data on both sides, because the child runs as the same user on the same flow.

For anything narrower, hand it over as input when the work starts and report it back when the work finishes. A session-scoped resource has a second route: mark it `sharedToLineage` and the conversation and every session under it resolve one copy of it. Session state has no such route; it is private to each session either way. See [State vs Resources](/docs/resources/storage#session-scope-and-background-work).

Dispatching is declared in the flow. A `dispatcher()` block sends a single piece of work. A task board seat holding a dispatcher sends every row it claims. There is no client call that starts either one.

### From a block: `dispatcher()`

A flow declares the work under `internal.actions`, beside `actions`. An internal entry has an action's shape, but no client can call it. A `dispatcher()` block in the same flow is the only way in:

```ts
import { defineFlow, dispatcher, generator } from "@flow-state-dev/core";
import { z } from "zod";

const investigate = generator({
  name: "investigate",
  model: "openai/gpt-5.4-mini",
  inputSchema: z.object({ company: z.string() }),
  prompt: "Research the company and write up what you find.",
});

const investigateInBackground = dispatcher({
  name: "investigate-in-background",
  type: "internal",
  target: "investigate",
  inputSchema: z.object({ company: z.string() }),
  session: { key: (input) => input.company },
});

export default defineFlow({
  kind: "diligence",
  actions: { start: { block: investigateInBackground } },
  internal: { actions: { investigate: { block: investigate } } },
})();
```

Run the dispatcher and it sends one request to the `investigate` entry and returns `{ sessionId, requestId, adopted }` as soon as the runtime accepts it, without waiting for the work. With `session: { key }` the work runs in a child of the running session, created on first use; the same key from the same conversation lands on the same child again, with `adopted: true`. With `session: { id }` it is delivered into a session that already exists, and refused if it doesn't. `defineFlow` throws at definition time when `target` names an entry the flow doesn't declare.

Read next: **[Starting a job from a flow](/docs/server/background-work#starting-a-job-from-a-flow)** for the `session` policies, the return shape, and every refusal by name.

### From a task board seat

A board is a list of tasks plus a set of named workers that claim them. A seat normally runs its tasks inline, in the request that claimed them. Put a `dispatcher({ type: "task" })` in the seat's position instead and the board hands each claimed row to a worker running in a child session. The worker is declared once on the flow, under `task.actions`, and the seat names it with `target`:

```ts
import { defineFlow, dispatcher } from "@flow-state-dev/core";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";

const diligenceTasks = defineTaskCollection({ id: "diligence-tasks", scope: "user" });

const board = taskBoard({
  name: "diligence",
  boardId: "diligence",
  collection: diligenceTasks,
  workers: {
    investigate: dispatcher({
      name: "hand-off-investigate",
      type: "task",
      target: "investigate",      // flow.task.actions.investigate
      session: "per-task",        // one child session per row
    }),
    summarize: summarizeBlock,    // a bare block runs inline, in the request that claimed the row
  },
  initialTasks: [
    { id: "filings", goal: "Read the Q3 filings", assignee: "investigate" },
    { id: "calls", goal: "Summarize the analyst calls", assignee: "investigate" },
  ],
});

export default defineFlow({
  kind: "diligence",
  actions: { run: { block: board.drain } },
  task: { actions: { investigate: { block: investigateBlock } } },
})();
```

The drain claims a row, sends it to the `investigate` entry, and moves on. The child runs `investigateBlock` with the same worker input an inline seat would get, and settles the row itself. Which child a row lands in is the seat's `session` policy: `"per-task"`, `"per-worker"`, or `{ key: (task) => string }`.

Tasks are seeded here to keep the example in one piece. A row added later with `addTask` carries the same `assignee` field.

A board with a seat that hands off needs an explicit `boardId` and a `defineTaskCollection()`. The child settles its row after the request that claimed it is gone, so the ledger it settles against has to outlive that request. Both are checked when the board is built.

Read next: **[Seats that hand off](/docs/orchestration/task-board#seats-that-hand-off)** for the `session` policies, what the board refuses at construction, and what the drain reports.

Some bounds are worth knowing before you reach for this.

**The board has to be reachable from the child session.** The child settles its own row, and resource scope resolves against whichever session is running, so a session-scoped board hydrates empty in the child and has nothing to settle. Give the collection `sharedToLineage: true` and the whole lineage settles against one ledger. `user` and `org` scope need nothing extra.

**On serverless, the work is bounded by the function unless something else consumes the queue.** A dispatched child runs inside the invocation that started it, so the function's maximum duration is the ceiling. A queue adapter alone does not lift it: in `colocated` mode the same process both enqueues *and* consumes, so the job is picked up by the invocation that is already running out of time. What lifts the ceiling is a consumer with its own lifetime — run the function in `dispatch-only` mode and host the worker separately, as a container or a long-lived process in `worker-only` mode. `colocated` is the right answer on a server you keep running, not on a function.

**A child started from a `worker-only` process isn't durable.** That mode installs no dispatcher, so the child runs in the worker process instead of going to the queue, and nothing re-runs it if that process stops. See [From a worker-only process](/docs/cli/overview#from-a-worker-only-process).

**A row released to a child stops holding up the drain.** A row a child has in hand is not counted by the board that filed it, so the request that filed it finishes without waiting.

That release lasts only while the child is actually holding the row, not for the rest of the row's life. Handing work over says where it belongs; it does not promise the work is still moving. If the child stops without settling the row — its process dies, its host is shut down — the row goes back to being the board's to deal with, and the next drain of that board waits on it like any other outstanding work. A row parked for a person counts again too, unless the board asked not to wait on reviews with [`onReview: "exit"`](/docs/orchestration/task-board#waiting-on-a-person-onreview).

You can exercise all of it from the terminal by running the flow against an `fsdev.config.*`. Whether the command waits for the background work before exiting depends on whether a queue is configured, and running without a config can't start it at all. See [Background work from the CLI](/docs/cli/overview#background-work).

Read next: **[Dispatched work](/docs/server/background-work)** for the HTTP surface, its paging, what `status` does and doesn't tell you, and the access rules the listing endpoint applies; **[Client overview](/docs/client/overview#child-sessions)** for reading it from an app; and **[Durable execution](/docs/advanced/durable-execution)** for what happens to a run that was interrupted.

## Nearby, and often confused

**A durable task collection is not a queue with a drainer behind it.** Declaring a collection with `defineTaskCollection` makes the task *state* survive across requests. Nothing pulls tasks off it on its own. They sit at whatever status they reached until some request mounts a board over the collection and drains it. See [The board lifecycle](/guides/board-lifecycle).

**A scheduled action is a fresh run with no caller**, not the continuation of an earlier one. A cron fires the action, the framework builds a request for it, and the same streaming and recovery machinery applies. See [Scheduled actions](/docs/server/scheduled).

## Watching any of it

Whichever path the work takes, the thing you observe is a request — for a side chain, the request it runs inside; for the other two, one of their own. Every run has an id, a lifecycle status, and an item log, and the same tools read all three.

- Attach live with `GET /api/flows/:kind/requests/:requestId/stream`. See [Streaming](/docs/streaming/overview).
- Read a session's runs with `listSessionRequests`, and the sessions started under it with `listChildSessions`. See [Client API](/docs/api/client).
- Reconnect and resume from a sequence number rather than replaying from zero. See [Connection resilience](/docs/server/connection-resilience).
- Inspect any of it block by block in the [DevTool](/docs/devtool/overview).
