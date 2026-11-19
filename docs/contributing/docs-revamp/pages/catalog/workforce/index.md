---
title: Workforce
type: catalog
description: A team of named agents your app reads from a folder of Markdown files, with a copy for every user, one built-in agent to run them, and the views a screen needs.
---

import Figure from "@site/src/components/Figure";
import WhatThisInstalls from "./figures/what-this-installs.svg";
import AWorkersTurn from "./figures/a-workers-turn.svg";

# Workforce

Once an app has more than one agent, the same questions come up every time. Where does each one's brief live? Is the user talking to their own copy or everyone's? Which agents may hand work to which? What does a screen show about them? Workforce answers them for you.

It gives your app a team of named agents, called workers. A team is a [folder of Markdown files](./the-workforce-folder.md) in your repo: each worker gets a name, a job and the instructions for doing it. Every user gets their own copy of each worker, with their own conversations, and can hire, edit and fire workers of their own while the app runs. A flow is one self-contained part of your backend, registered with the server for clients to call. One built-in flow, `agent`, runs every worker unless the worker's file names a different flow. [Workers](../../concepts/workers.md) explains what a single worker is.

Workforce is a kit: a feature an app installs with one config line. The rest of Flow State's agent features build on it: the `harnesses` kit requires it, and each starter in this catalog is an app on top of it. What it unlocks, each on a page of its own:

- **One worker in front of a team.** A [coordinator](./coordinators.md) takes each message and hands it to the delegate that should answer.
- **Work handed down.** A worker [files tasks](./delegating-work.md) for its delegates, each worked in a session of its own, and hears how each ended.
- **Workers that talk.** A worker [messages another](./messaging.md) on the same user's roster, then goes on with its turn or waits for the reply.
- **Shared projects.** In a [project](./projects.md), users see where each other's work stands, and every conversation stays private.
- **Bug reports.** The [Error Reporter](./error-reporter.md) turns a failure that doesn't recover into one report, previewed before it is filed.
- **Screens.** [Components](./screens.md) draw a roster and its task boards.
- **Coding agents as workers.** Claude Code, Codex and Cursor run as workers through the [harnesses](../harnesses/index.md) kit, which adds a coding worker to your team.

<Figure svg={WhatThisInstalls} caption="What the workforce kit installs" description={"Three columns. On the left, your app's workforce folder: teams/support/workers/billing, with its WORKER.md highlighted as the part you write, then a blocks folder and org/workers. Arrows lead from the folder to two flows the kit serves: agent, which runs every worker whose file names no flow, and workforce-roster, which hires, forks, edits, fires and resets. Arrows lead from each flow to the views it answers: listTasks_tasks from agent, and roster, workerUsage, workstreamReport and routines from workforce-roster. A band below lists three slots the kit opens for other kits: workerFlows, uses and flows. Two notes say the folder is read once at start-up, and that another kit adds a kind of worker by filling workerFlows."} />

With a folder holding one worker, the app serves exactly two flows: `agent` and `workforce-roster`.

## What you get

- **A team from a folder.** Add `workforce/teams/support/workers/billing/WORKER.md` and `support.billing` exists, for every user.
- **A worker from a few lines.** A file with a description and a body is a working worker.
- **Workers users own.** A user hires, forks, edits and fires workers while the app runs. No restart, and nothing in your repo changes.
- **A roster and views for screens.** One call returns each user's workers, standard and their own.

## Install it

```bash title="Terminal"
pnpm add @flow-state-dev/workforce
```

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { workforce } from "@flow-state-dev/workforce/kit";

export default createFlowState({
  kits: [workforce({ agent: { model: "openai/gpt-6-luna" } })],
});
```

The kit reads `workforce/` beside the app, once, when the app starts. Every file in it must be a `WORKER.md`, a `TEAM.md`, a `SKILL.md` or a code file the layout names. A stray file stops the app, and the error names it. The folder rules are in the [Workforce reference](../../reference/workforce.md).

## Use it

### The built-in agent

A worker file that names no flow runs on `agent`. Each turn runs as the worker its conversation names, on the model its file's `model:` line gives, or `agent.model` where the file names none.

<Figure svg={AWorkersTurn} caption="What goes into one turn of a worker" description={"On the left, four boxes with arrows into one dashed box on the right. The boxes are the brief, the tools, memory and the conversation. Memory and the conversation are hatched because they outlive the request. The dashed box is one turn of support.billing, which is one model call of at most 50 steps by default. Two notes say memory is off until the app adds it, and that the model sees the last 50 turns of this conversation and none from another."} />

**Tools.** A worker has no tools of its own unless its file grants them, and a `tools:` line is the whole of what the file grants. The framework's control tools stay available whatever the line says: `sendMessage` on every turn, the standing-rule tools on a turn the user started, and the task tools while the worker has a delegate that takes tasks. A worker's own tool is a block in its `blocks/` folder, named in `tools:`.

```md title="workforce/teams/support/workers/billing/WORKER.md"
---
description: Answers billing questions from the order record.
tools: [look-up-order]
---

You answer billing questions for the support team. Look the order up before you answer, and say plainly when you cannot find it.
```

```ts title="workforce/teams/support/workers/billing/blocks/look-up-order.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export default handler({
  name: "look-up-order",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({ status: z.string() }),
  execute: async ({ orderId }) => ({ status: `Order ${orderId} shipped` }),
});
```

Run `fsdev gen`. It writes `workforce/workforce.gen.ts`, which lists every block in the folder. Pass that module to the kit as `generated`:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { workforce } from "@flow-state-dev/workforce/kit";
import * as generated from "./workforce/workforce.gen";

export default createFlowState({
  kits: [workforce({ generated, agent: { model: "openai/gpt-6-luna" } })],
});
```

If a `tools:` entry names a block that nothing registers, the app stops at start-up and the error names the entry.

**Skills.** A skill is a folder holding a `SKILL.md`, placed under `org/skills/`, a team's `skills/`, or a worker's own. A message that starts `/<skill>` activates it for that turn. A worker that holds a skill is also offered a tool to load it and a list of its skills on every turn, which costs tokens in proportion to the list. The [Workforce reference](../../reference/workforce.md) has the settings that turn both off.

**Memory.** A worker sees its conversation's last 50 turns and nothing said in another. Long-term memory is off until you add it. Put the memory capability in `agent.uses` and its write side in `agent.afterAnswer`:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { system } from "@flow-state-dev/memory";
import { workforce } from "@flow-state-dev/workforce/kit";

const mem = system({ model: "openai/gpt-6-luna", working: { capacity: 7 }, episodic: true, semantic: true });

export default createFlowState({
  kits: [
    workforce({
      agent: {
        model: "openai/gpt-6-luna",
        uses: [mem.capability.presets({ recall: false, connect: false, semantic: true, episodic: true })],
        afterAnswer: mem.captureFromItems,
      },
    }),
  ],
});
```

Without `afterAnswer`, long-term memory stays empty.

### A user's own workers

A user hires a worker from the client:

```ts title="src/lib/workforce.ts"
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

export async function hireScribe(userId: string, baseUrl: string) {
  const workforce = createWorkforceClient(createClient({ userId, baseUrl }));
  const hired = await workforce.hire({ id: "scribe", instructions: "Take short notes." });
  const stop = workforce.watchRoster((roster) => {
    console.log(roster.map((worker) => worker.id));
  });
  return { hired, stop };
}
```

`hired` is `{ id: "scribe", flow: "agent" }`, and `scribe` is on the roster at once. Nothing appears in `workforce/` and nothing restarts: the user's next turn runs the new worker, on any process of the app. `watchRoster` hands over the roster, and again each time a hire, fork, edit or fire changes it.

- **Fork.** `fork(from, id)` copies a worker, standard or the user's own, into a new worker of the user's own. The copy does not change when the files do.
- **Edit.** `edit({ id, ... })` replaces each field given. Editing a standard worker makes the user's own copy under the same id, and other users keep the file's version. `reset(id)` deletes the copy.
- **Fire.** `fire(id)` removes the worker. Past conversations stay readable, but a new message in one is refused with `Worker "scribe" was fired. This session stays readable; a new turn can't run as it.`

You can't hire, fork into, or fire under a standard worker's id, and you can't hire under an id already on the roster. The call rejects with an `Error` whose message names the id and says nothing was written. The messages are in the [Workforce reference](../../reference/workforce.md).

| Stored part | Whose | Who sees it |
| --- | --- | --- |
| A standard worker | The app | Every user, the same for all who have not edited it |
| A user's own worker | One user | That user |
| An edited standard worker | One user | That user; everyone else gets the file |
| A worker's skills | One worker, for one user | That user |
| Long-term memory | The user | That user's workers on `agent` |

A user's own workers belong to the organization they are signed in to. A user in two organizations has a separate roster in each.

### What a worker can find

A worker often needs to know what is around it: which workers it can hand work to, which skills it can load. A list in its instructions is paid for on every step. `discover` is one tool call that returns the list only when the worker asks, so the list costs tokens on that call alone. The tool's own definition is sent with the worker's other tools on every step.

`discover({ domain: "workers" })` returns one domain: `workers`, `skills` or `resources`. Leave `domain` out and it returns all three. Discovery never widens reach: what a model may not read is absent, not listed.

The kit does not switch `discover` on. Add `createWorkforceCapability` to `agent.uses`, as with memory above. The [Workforce reference](../../reference/workforce.md) has its options and what each domain lists.

## Slots it opens

Workforce opens these slots for other kits to fill. It fills none of its own.

- **`workerFlows`** adds a kind of worker. A worker's file picks one with `flow:`. The `harnesses` kit fills it with `coder`.
- **`uses`** adds a capability to the agent flow.
- **`flows`** lets another kit serve its own flows alongside this one's.

## Views it serves

A view answers one question from stored data and never writes.

- On `workforce-roster`: `roster`, the user's workers, standard and their own; `workerUsage`, tokens each worker used, by model, over a number of days; `workerSessions`, the user's conversations with a worker; `sessionTurns`, one conversation's turns, with status and times but not their words; `workerMessages`, a worker's open messages and their answers; `inbox`, what waits on the user across their conversations; `workstreamReport`, the latest report from a workstream a worker leads; and `routines`, the user's scheduled routines.
- On `agent`: `listTasks_tasks`, the conversation's task list; and `delegates`, the workers the conversation hands tasks to.

`roster` answers for a user before their first conversation. From the browser, `rosterView` and `workerUsageView` come from `@flow-state-dev/workforce/browser`.

## Change it

Edit a `WORKER.md` and deploy: the worker changes for every user who has not edited it. `agent.model` sets the model for workers that name none. `agent.catalog` registers tool blocks any worker may name. `directory` moves the folder. The other config keys are in the [Workforce reference](../../reference/workforce.md).

## Next

- [Workers](../../concepts/workers.md): what a worker is, who owns each part, and what runs it.
- [The workforce folder](./the-workforce-folder.md): where each file goes and who it reaches.
- [Kits and slots](../../concepts/kits-and-slots.md): how a kit fills the slots Workforce opens.
- [Workforce reference](../../reference/workforce.md): hire options, the roster entry, usage and discovery output, and the folder rules. File settings are in the [WORKER.md reference](../../reference/worker-md.md).
