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

`respondToUser` streams to the browser and the chain moves straight on. `captureMemory` runs alongside it. The request itself does wait: every queued task settles before the stream closes, so the work finishes even when the user closes the tab. A failure is logged rather than surfaced, which is the trade you take for not blocking.

Reach for it when the work is cheap, best-effort, and belongs to the turn that produced it. Analytics, cache warming, memory writes, auto-titling.

Read next: **[Side chains](/docs/advanced/sequencer-side-chains)** for `.workIf()`, `.forEachBackground()`, the `.waitForWork()` barrier, and why a background task sees a different abort signal than the foreground chain.

## Queue-backed action runs: the same request, somewhere else

Hand `createFlowState` a worker adapter and actions stop running in the process that accepted them.

```ts
import { createFlowState } from "@flow-state-dev/engine";
import { bullmqWorker } from "@flow-state-dev/bullmq";

export const flowstate = createFlowState({
  flows: { billing },
  stores: { /* a backend the web process and the workers both reach */ },
  worker: bullmqWorker({ connection: process.env.REDIS_URL! }),
});
```

A POST to an action now returns a request id instead of running the action. A worker picks the job up, runs it against the same stores, and the client attaches to `GET /requests/:id/stream` exactly as it would for an in-process run. Same request, same session, different process. A worker that dies mid-action retries the job.

Reach for it when the run is long or heavy enough that you don't want it on the web tier at all, or when you want to scale workers separately.

Read next: **[Background jobs with BullMQ](/guides/background-jobs-bullmq)** for the setup, from Docker to separated worker containers, and **[Host adapters](/docs/server/host-adapters)** for where this sits among the deployment shapes.

## Workstreams: a job with its own session

A workstream is background work that runs in a session of its own, hanging off the conversation that started it. Its runs don't show up in the parent session's request list. You reach them by asking the parent conversation what work belongs to it, then opening one.

```ts
import { createSessionClient } from "@flow-state-dev/client";

const sessions = createSessionClient({ baseUrl: "/api" });

const workstreams = await sessions.listWorkstreams("sess_abc");
const first = workstreams[0];
const runs = first === undefined ? [] : await sessions.listSessionRequests(first.id);
```

A workstream's `id` is a session id, so every session read works on it, and a workstream that files work of its own has workstreams too.

This is what the task board's detached workers address. A board can declare that a worker's tasks run outside the request that claimed them, and the worker is addressed by the board's `boardId` plus that worker's coordinate, so a later run can still find the block that does the work. Such a board needs a durable collection and an explicit `boardId`, because that id is part of the child session's identity.

Starting a workstream happens from inside a running request, through `ctx.requestHost.startDetached`. There is no client call and no HTTP route that starts one, and the shipped router wires no start operation, so on a stock server that call refuses with `no-start-operation` and a conversation's workstream list comes back empty.

Read next: **[Background work](/docs/server/background-work)** for the HTTP surface, its paging, and what `status` does and doesn't tell you, and **[Client overview](/docs/client/overview#background-work)** for reading it from an app.

## Nearby, and often confused

**A durable task collection is not a queue with a drainer behind it.** Declaring a collection with `defineTaskCollection` makes the task *state* survive across requests. Nothing pulls tasks off it on its own. They sit at whatever status they reached until some request mounts a board over the collection and drains it. See [The board lifecycle](/guides/board-lifecycle).

**A scheduled action is a fresh run with no caller**, not the continuation of an earlier one. A cron fires the action, the framework builds a request for it, and the same streaming and recovery machinery applies. See [Scheduled actions](/docs/server/scheduled).

## Watching any of it

Whichever path the work takes, the thing you observe is a request. Every run has an id, a lifecycle status, and an item log, and the same tools read all three.

- Attach live with `GET /api/flows/:kind/requests/:requestId/stream`. See [Streaming](/docs/streaming/overview).
- Read a session's runs with `listSessionRequests`, and a conversation's jobs with `listWorkstreams`. See [Client API](/docs/api/client).
- Reconnect and resume from a sequence number rather than replaying from zero. See [Connection resilience](/docs/server/connection-resilience).
- Inspect any of it block by block in the [DevTool](/docs/devtool/overview).

## Related

- [Side chains](/docs/advanced/sequencer-side-chains) — `.work()`, `.workIf()`, `.forEachBackground()`
- [Background jobs with BullMQ](/guides/background-jobs-bullmq) — queue-backed runs end to end
- [Background work](/docs/server/background-work) — the workstream HTTP surface
- [The board lifecycle](/guides/board-lifecycle) — what a task board's durability does and doesn't buy you
- [Durable execution](/docs/advanced/durable-execution) — what happens to a run that was interrupted
