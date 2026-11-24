---
title: Background work
type: concept
description: Where to put work that should not hold up the reply, chosen by what the work needs to be there when it finishes.
---

import Figure from "@site/src/components/Figure";
import Outlives from "./figures/background-work-outlives.svg";

# Background work

Not everything an app does belongs in the reply. A support desk drafts an answer to a ticket, and then it wants the ticket summarised, a report built that takes ten minutes, an account audited, a digest sent every morning. None of that should hold up the customer.

Where it goes depends on what the work needs to be there when it finishes: the request that started it, a queue process, or a session of its own to keep its record in.

<Figure svg={Outlives} caption="What each kind of background work outlives" description={"One question in a highlighted box at the top: what has to be alive when it finishes? Below it, a timeline with three vertical marks: the reply ends, the request ends, the process ends. Three rows, each a bar on that timeline. The side chain summarizeTicket runs alongside the reply and stops at the end of the request; it has a dashed outline because it lasts one action run. The queued run buildReport runs in another process and carries on past the end of the web process. The dispatch auditAccount runs in a session of its own; its bar has a hatched top because it outlives the request, and on a host with no queue it stops where the process stops. Three notes say the same in words: a crash drops a side chain's unfinished work, a queued run is the same request worked by another process, and a dispatch with no queue behind it still lives in the web process."} />

## If you know job queues

A queued run is what you expect: you send work away, it runs somewhere else, and a failed job is retried. The difference is the unit. A job queue's job is a function call with a payload. Here it is a request on the same flow, and the client watches the same stream it would for a run in the web process.

## Alongside the reply

A side chain is a block that runs beside a sequence of blocks instead of as one of its steps. In a sequencer, which runs blocks in order, `.sideChain()` adds one.

```ts title="src/flows/support/blocks/handle-ticket.ts"
import { sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { cleanMessage } from "./clean-message";
import { draftReply } from "./draft-reply";
import { summarizeTicket } from "./summarize-ticket";

export const handleTicket = sequencer({
  name: "handle-ticket",
  inputSchema: z.object({ message: z.string() }),
})
  .step(cleanMessage)
  .step(draftReply)
  .sideChain(summarizeTicket);
```

`cleanMessage`, `draftReply` and `summarizeTicket` are blocks, each in its own file beside this one. `summarizeTicket` receives what `draftReply` produced, and the chain does not wait for it. The reply streams to the browser while the summary is written.

A failure in the summary does not fail the request. It is logged and shows in the DevTool, the local debugging UI, but nothing reaches the user's stream. A crash drops whatever had not finished. [Side chain lifetime and failure](../reference/background-work.md) has the rest.

A side chain suits work that is cheap, best-effort and belongs to the turn that produced it: summaries, analytics, memory writes. When losing it to a crash matters, use one of the next two.

## The same request, somewhere else

Give the app a queue, `bullmqJobQueue`, and each action call becomes a job on it. A job is a request on the same flow, worked from Redis against the same stores.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { bullmqJobQueue } from "@flow-state-dev/bullmq";
import { postgresStores } from "@flow-state-dev/store-postgres";
import support from "./src/flows/support/flow";

export default createFlowState({
  flows: [support],
  stores: postgresStores({ connectionString: process.env.FSD_DB_URL }),
  jobQueue: bullmqJobQueue({ connection: process.env.REDIS_URL! }),
});
```

The queue is a setting of the app, not of one action. Say the support flow has a `buildReport` action: calling it returns a request id, and the client attaches to the stream as usual.

A ten-minute report is the case for it. The user closes the tab and the job carries on. By default the web process takes the jobs and runs them. You can also run queue processes on their own. [Queued runs](../reference/background-work.md) has the options, and the setup is in [Run background jobs with BullMQ](../build/background-jobs-bullmq.md).

## In a session of its own

A session is where a flow keeps many requests together as one record. A dispatch sends one unit of work to a session of its own, with its own state and history, apart from the conversation that started it.

The work is an entry the flow declares under `internal.actions`, beside `actions`. No client can call it. A `dispatcher()` block reaches it, from the same flow or, naming this flow with `flowKind`, from another registered flow ([flows reference](../reference/flows.md)).

```ts title="src/flows/support/flow.ts"
import { defineFlow, dispatcher } from "@flow-state-dev/core";
import { z } from "zod";
import { auditAccount } from "./blocks/audit-account";

const startAudit = dispatcher({
  name: "start-audit",
  action: "audit",
  inputSchema: z.object({ customerId: z.string() }),
  session: { key: (input) => input.customerId },
});

export const supportFlow = defineFlow({
  kind: "support",
  actions: { startAudit },
  internal: { actions: { audit: auditAccount } },
});

export default supportFlow();
```

`auditAccount` is a block in its own file. Calling `startAudit` returns at once, without waiting for the audit ([what it returns](../reference/background-work.md)). `session.key` names the session the work runs in, one per customer for each conversation. Dispatching the same customer again from this conversation reuses that session, and the call reports `adopted: true`. Another conversation that dispatches the same customer gets a session of its own.

The session does not see the conversation's state. The audit can read user-scoped data, and any session resource the conversation declares as shared ([Resources](./resources.md)). Everything else goes in as input. The audit's result does not come back to the conversation, so have the audit write its findings somewhere the conversation can read them, such as a user-scoped resource.

A session of its own is not a separate process. On a host (the server your app runs on) with no queue, a dispatch stops when the web process stops. With a queue, it runs as a job ([how dispatch is delivered](../reference/background-work.md)).

## Work that starts on its own

Some runs start with no user behind them. A webhook is one, an event another service posts, which the host turns into a run. A schedule is the other.

A schedule is a named entry on the flow with a cron string, say `daily-digest` at seven each morning. The app fires it itself: once a minute it checks what is due, the schedules on the flow and the ones stored while it runs, and runs each one once per scheduled time. If several servers share one database, one of them does the checking. On a serverless host such as Vercel, where nothing stays running, one cron route does the check instead. Each firing is a fresh run that no user started, not the continuation of the last. The fields and the endpoint are in the [schedules reference](../reference/schedules.md), and the serverless setup is in [Run on a schedule with Vercel Cron](../build/schedules/vercel-cron.md).

## What it gets you

**A side chain costs the customer no wait.** `summarizeTicket` finishes while the request is open, and the reply has already streamed.

**A queued run survives the browser.** `buildReport` is a job in Redis, so a closed tab does not stop it, and a job whose queue process dies is retried.

**A dispatch leaves a record.** `auditAccount` runs in the customer's audit session, so its history sits there, apart from the conversation's.

**One way to watch all three.** A side chain shows up in the request that started it, and a queued run and a dispatch each have a request id and a status of their own, so the same stream and the DevTool read them all ([how each is watched](../reference/background-work.md)).

## How it fits with the others

A task board is not a background queue. Its tasks wait until a request works through the board. A board can hand each task to a dispatch, and those dispatches are the background work. [Tasks and boards](./tasks-and-boards.md) has the loop.

[Composition](./composition.md) covers the other ways to join blocks. A webhook or a schedule is a way into a flow, covered in [Serving flows](./serving-flows.md). A dispatch hands work on from inside one.

## Next

- [Background work reference](../reference/background-work.md): options, delivery, retries and what each does when it fails.
- [Run background jobs with BullMQ](../build/background-jobs-bullmq.md): Redis, queue processes apart from the web process and the queue's settings.
- [Tasks and boards](./tasks-and-boards.md): work with an order, handed to dispatch runs.
- [Schedules reference](../reference/schedules.md): cron fields and the dispatch endpoint.
