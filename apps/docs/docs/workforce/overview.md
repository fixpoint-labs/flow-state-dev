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

## What a Workforce app looks like

A Workforce app is a roster, the channels that roster talks in, and the boards its work sits on. A board is a list of tasks, each one something somebody takes and finishes. You describe the roster in files, hire it, and open sessions against the seats you get back.

- **The roster outlives the process.** A team you hire while the app is running is still there after a restart or a redeploy, because the hire is written to the store your app uses. See [Hiring while the app runs](./durable-hire).
- **A channel is what a reader opens.** A channel is a named session on a kind the framework ships, and its transcript is the part of that conversation a person or another agent should read. See [Channels](./channels).
- **The screens are importable.** One navigator browses the whole workforce, and the roster and board columns ship beside it, as components from `@flow-state-dev/react`. See [Workforce components](./ui).

Files are the authoring path. A `WORKER.md` under `teams/` and a `CHANNEL.md` beside it are how a roster is written down. Hiring at runtime adds to that roster; it doesn't replace the tree.

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
// without a skill it should have had; `teamErrors` is a team file that failed.
// Each is collected rather than thrown, so an array you forget to check is
// one that reports nowhere.
const { workers, errors, skillErrors, teamErrors } = await readWorkforce("./workforce");
if (errors.length || skillErrors.length || teamErrors.length) {
  throw new Error(
    `workforce: ${errors.length} worker(s) failed to load, ` +
      `${skillErrors.length} loaded short, ` +
      `${teamErrors.length} team file(s) failed`,
  );
}

const seats = hireWorkforce(workers);

flowRegistry.registerMany(seats);
```

That worker file names no `flow:`, so it runs on the built-in worker kind. Its body becomes its instructions, and it talks. It has no memory: nothing it is told survives the turn.

A **skill** is a folder of instructions a worker can pull into a turn. `readWorkforce` collects the skills sitting beside each worker in the tree, and the built-in reads them. Each organization keeps its own copy of a seat's skills. When you call the worker's action, send `userId` beside `input`. The call never names the organization: every request runs in one, and [Authentication](../server/authentication.md#every-request-runs-in-an-organization) covers where it comes from. [The built-in worker](./built-in-worker.md) covers its settings, what your app can configure, and the rest of what it does not do.

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
- [Inventory](./inventory) — a record of every seat and channel registered in an organization, readable by a block.
- [Documents on disk](./documents-on-disk) — a team's shared reference material as Markdown, installed as resources.
- [Code on disk](./code-on-disk) — your own flow kinds, blocks and capabilities in the same tree, registered by `fsdev gen`.
- [Capabilities on disk](./capabilities-on-disk) — what a capability in a `resources/` folder gives a worker, and how a worker's file picks its presets.
- [Hiring while the app runs](./durable-hire) — a roster hired at runtime, written to your store, reloaded on the next boot.
- [Workforce components](./ui) — browse your flow kinds, instances and sessions, and render a roster and boards, with React components.
- [Orchestration](../orchestration/overview) — the task board and the workers that drain it.
- [Agents](../orchestration/agents) — board workers, `definePersona`, and `createWorkforceCapability`.
- [Flows](../fundamentals/flows.md) — how a flow copy is configured and addressed.
