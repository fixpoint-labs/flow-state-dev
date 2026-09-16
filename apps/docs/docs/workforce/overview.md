---
title: Workforce
sidebar_position: 1
sidebar_label: Overview
description: Describe a roster of workers, hire them as addressable flow copies, and register what comes back.
---

# Workforce

`@flow-state-dev/workforce` turns a roster of workers into configured, addressable copies of flows you already defined. Describe each worker (usually as a `WORKER.md`), hire the roster, and register the copies that come back.

A hired worker is a **seat**: a flow instance with its own id. You open a session against it the way you open one against any other flow.

## Workforce or orchestration

Reach for Workforce when you want a named roster you address by opening a session.

Reach for [Orchestration](../orchestration/overview) when you want to coordinate units of work on a task board. A board worker is a block that claims tasks. A task's `assignee` never names a hired worker.

## Hire a roster

Each worker lives at `teams/<team>/workers/<name>/WORKER.md`. `teams/engineering/workers/lead/` hires as `engineering.lead`.

```md
---
description: Holds the board.
model: openai/gpt-5.4-mini
---
You are the engineering lead. You break work into tasks and report what came back.
```

```ts
import { hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";

// `errors` is a worker that failed to load; `skillErrors` is one that loaded
// without a skill it should have had. Both are collected, never thrown.
const { workers, errors, skillErrors } = await readWorkforce("./workforce");
if (errors.length || skillErrors.length) {
  throw new Error(
    `workforce: ${errors.length} worker(s) failed to load, ` +
      `${skillErrors.length} loaded short`,
  );
}

const seats = hireWorkforce(workers);

flowRegistry.registerMany(seats);
```

That worker file names no `flow:`, so it runs on the built-in worker kind. Its body becomes its instructions, and it talks.

It has no memory — nothing it is told survives the turn. A **skill** is a folder of instructions a worker can pull into a turn; `readWorkforce` collects the ones sitting beside each worker in the tree, and the built-in reads them. Those skills are stored at org scope, so a request to one of these workers has to carry an `orgId`. [The built-in worker](./built-in-worker.md) covers its settings, what your app can configure, and the rest of what it does not do.

To run a worker on a flow you wrote yourself, name that flow's kind in the worker's `flow:`. Here is `teams/engineering/workers/triage/WORKER.md`:

```md
---
description: Sends an incoming request to an answer or to a person.
flow: request-triage
---
Answer directly when the request is a question about a feature that already shipped.
```

Then pass the flow under that same kind when you hire:

```ts
import { requestTriageFlow } from "./flows";

const seats = hireWorkforce(workers, {
  kinds: { "request-triage": requestTriageFlow },
});
```

`requestTriageFlow` is your own `defineFlow(...)`, and `"request-triage"` is its `kind`. A record that names no `flow:` is hired into the built-in, so one roster can run both. You get back one seat per worker, ordered by id.

Pass a flow under a key that is not its own `kind` and the hire is refused. [Workers on disk](./workers-on-disk.md#when-a-worker-needs-more-than-settings) walks through writing a flow kind of your own.

`hireWorkforce` reads no files and registers nothing. A refused hire throws and returns nothing.

`readWorkforce` is Node-only (`@flow-state-dev/workforce/loader`). Import `hireWorkforce` from `@flow-state-dev/workforce`.

## What it will not do

Workforce does not staff a task board. It does not replace flows, sessions, or resources. Sessions and resources live on the flow copy you hired.

## Related pages

- [Workers on disk](./workers-on-disk) — the folder tree, `WORKER.md`, `readWorkforce`, and `hireWorkforce`.
- [The built-in worker](./built-in-worker) — the `agent` kind a record with no `flow:` runs on: its settings, tools, skills, and memory.
- [Channels](./channels) — several agents on one topic, with one durable transcript and nobody owning a row.
- [Orchestration](../orchestration/overview) — the task board and the workers that drain it.
- [Agents](../orchestration/agents) — board workers, `definePersona`, and `createWorkforceCapability`.
- [Flows](../fundamentals/flows.md) — how a flow copy is configured and addressed.
