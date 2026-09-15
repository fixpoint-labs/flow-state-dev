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
import { readWorkforceDirectory } from "@flow-state-dev/workforce/loader";

const { workers, errors } = await readWorkforceDirectory("./workforce");
if (errors.length) {
  throw new Error(`workforce: ${errors.length} worker(s) failed to load`);
}

const seats = hireWorkforce(workers);

flowRegistry.registerMany(seats);
```

That worker file names no `flow:`, so it runs on the built-in worker kind. It talks, its body becomes its instructions, and it reaches whatever skills its folders hold. It has no memory — nothing it is told survives the turn. [The worker you get without writing one](./workers-on-disk#the-worker-you-get-without-writing-one) covers its settings, what your app can configure, and the rest of what it does not do.

To run a worker on a flow you wrote yourself, pass that flow in `kinds` and name it in the worker's `flow:`:

```ts
import { customAgentFlow } from "./flows";

const seats = hireWorkforce(workers, {
  kinds: { "custom-agent": customAgentFlow },
});
```

`customAgentFlow` is your own `defineFlow(...)`. Pass each flow under its own `kind`. What comes back is one `FlowInstance` per worker, ordered by id. [Workers on disk](./workers-on-disk#when-a-worker-needs-more-than-settings) walks through writing one.

`hireWorkforce` reads no files and registers nothing. A refused hire throws and returns nothing.

`readWorkforceDirectory` is Node-only (`@flow-state-dev/workforce/loader`). Import `hireWorkforce` from `@flow-state-dev/workforce`.

## What it will not do

Workforce does not staff a task board. It does not replace flows, sessions, or resources. Sessions and resources live on the flow copy you hired.

## Related pages

- [Workers on disk](./workers-on-disk) — the folder tree, `WORKER.md`, `readWorkforceDirectory`, and `hireWorkforce`.
- [Channels](./channels) — several agents on one topic, with one durable transcript and nobody owning a row.
- [Orchestration](../orchestration/overview) — the task board and the workers that drain it.
- [Agents](../orchestration/agents) — board workers, `definePersona`, and `createWorkforceCapability`.
- [Flows](../fundamentals/flows.md) — how a flow copy is configured and addressed.
