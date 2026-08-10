---
title: Work that outlives the turn
sidebar_label: Work that outlives the turn
description: "What background work means in flow-state-dev: side chains, queue-backed action runs, and workstreams, what each one outlives, and which page documents it."
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
| **Workstream** | a child session | the request that started it | yes |

If you can answer "what still has to be alive when this finishes", you've picked one.

## Side chains: alongside the turn

Inside a sequencer, `.work()` queues a block to run next to the chain instead of in it.

```ts
import { sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const turn = sequencer({
  name: "turn",
  inputSchema: z.object({ message: z.string() }),
})
  .step(respondToUser)
  .work(captureMemory);
```

`respondToUser` streams to the browser and the chain moves straight on. `captureMemory` runs alongside it. On a run that finishes normally the request waits: every queued task settles before the stream closes. Closing the tab doesn't cancel that work — background tasks deliberately don't listen to the transport signal — but nothing waits for it either, so a process that shuts down first can still drop it. An explicit abort does cancel it. A failure is logged rather than surfaced, which is the trade you take for not blocking.

Reach for it when the work is cheap, best-effort, and belongs to the turn that produced it. Analytics, cache warming, memory writes, auto-titling.

Read next: **[Side chains](/docs/advanced/sequencer-side-chains)** for `.workIf()`, `.forEachBackground()`, the `.waitForWork()` barrier, and why a background task sees a different abort signal than the foreground chain.

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

The configuration above runs in `colocated` mode, the default: one process both accepts jobs and consumes them, so you get the queue's durability and its retries without deploying anything new. Separating the tiers is a mode flag rather than a rewrite — `dispatch-only` on the web process, `worker-only` on a dedicated worker that calls `flowstate.ready()` to start consuming.

Reach for it when the run is long or heavy enough that you don't want it on the web tier at all, or when you want to scale workers separately.

Read next: **[Background jobs with BullMQ](/guides/background-jobs-bullmq)** for the setup, from Docker to separated worker containers, and **[Host adapters](/docs/server/host-adapters)** for where this sits among the deployment shapes.

## Workstreams: a job with its own session

A workstream is background work that runs in a session of its own, hanging off the conversation that started it. Its runs don't show up in the parent session's request list. You reach them by asking the parent conversation what work belongs to it, then opening one.

```ts
import { createSessionClient } from "@flow-state-dev/client";

const sessions = createSessionClient();

const workstreams = await sessions.listWorkstreams("sess_abc");
const first = workstreams[0];
const runs = first === undefined ? [] : await sessions.listSessionRequests(first.id);
```

A workstream's `id` is a session id, so every session read works on it, and a workstream that files work of its own has workstreams too.

Having its own session is also what it costs you. A workstream keeps its own state, its own history, and its own session-scoped resources, and none of those are the parent conversation's. What the two do share is the user: user- and org-scoped data is the same data on both sides, because a workstream runs as the same user on the same flow. Anything narrower than that has to be handed over when the work starts, or reported back when it finishes.

This is where the task board's detached workers are headed. A board can declare that a worker's tasks belong outside the request that claimed them, addressed by the board's `boardId` plus that worker's coordinate so a later run can still find the block that does the work. Such a board needs a durable collection and an explicit `boardId`, because that id is part of the child session's identity. That declaration is groundwork today: a worker declared detached is validated and routed, and then still runs inline, inside the claiming request.

Starting a workstream is server-side only, and no stock server wires it yet.

Read next: **[Background work](/docs/server/background-work)** for the HTTP surface, its paging, what `status` does and doesn't tell you, and what a stock server does about starting one; **[Client overview](/docs/client/overview#background-work)** for reading it from an app; and **[Durable execution](/docs/advanced/durable-execution)** for what happens to a run that was interrupted.

## Nearby, and often confused

**A durable task collection is not a queue with a drainer behind it.** Declaring a collection with `defineTaskCollection` makes the task *state* survive across requests. Nothing pulls tasks off it on its own. They sit at whatever status they reached until some request mounts a board over the collection and drains it. See [The board lifecycle](/guides/board-lifecycle).

**A scheduled action is a fresh run with no caller**, not the continuation of an earlier one. A cron fires the action, the framework builds a request for it, and the same streaming and recovery machinery applies. See [Scheduled actions](/docs/server/scheduled).

## Watching any of it

Whichever path the work takes, the thing you observe is a request — for a side chain, the request it runs inside; for the other two, one of their own. Every run has an id, a lifecycle status, and an item log, and the same tools read all three.

- Attach live with `GET /api/flows/:kind/requests/:requestId/stream`. See [Streaming](/docs/streaming/overview).
- Read a session's runs with `listSessionRequests`, and a conversation's jobs with `listWorkstreams`. See [Client API](/docs/api/client).
- Reconnect and resume from a sequence number rather than replaying from zero. See [Connection resilience](/docs/server/connection-resilience).
- Inspect any of it block by block in the [DevTool](/docs/devtool/overview).
