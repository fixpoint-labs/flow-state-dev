---
title: The chief of staff
sidebar_position: 12
sidebar_label: Chief of staff
description: "One worker a person asks who works here, and asks for workers of their own. Hires land at once; a fire waits for the person's approval. It can also start projects."
---

# The chief of staff

The chief of staff is a worker a person talks to about the organization itself. Ask it who works here or who is in a mailbox, and it looks it up. Ask it for another worker, and it hires one of your own. Ask it for one fewer, and it puts the fire in front of you to approve. Nothing is removed until you do. Give it the project tools, and it starts [projects](./projects.md) for you too.

A worker it hires belongs to the person it is talking to: it is on their roster and nobody else's, as [Hiring and forking](./durable-hire.md) describes. A Lab that doesn't declare a chief of staff doesn't have one.

## Adding one

You need two things: a `WORKER.md` for the worker, and the hire and fire tools in the catalog of the flow it runs on.

The file goes under `org/workers/`, beside `teams/`. Its folder name is its id, so `org/workers/chief-of-staff/` is the worker `chief-of-staff`. It runs on the built-in `agent` flow and names the tools it holds:

```md title="workforce/org/workers/chief-of-staff/WORKER.md"
---
description: Who works here, and the one worker that hires more.
flow: agent
model: openai/gpt-5.4-mini
tools: [hire, fire, post-to-mailbox]
---

You are the chief of staff for this organization.

When someone asks who works here or who is in a mailbox, look it up with
`discover` and answer from what it returns.

To add a worker for the person, call `hire`. It lands at once. To remove one
of theirs, call `fire`. The person approves every fire before it happens; if
they deny it, say so and don't try again unless they ask.

To hire a worker on `coder`, pass `settings: { "document": "teams/eng/feature-brief" }`.

You can't fire yourself or any worker declared in the organization's files.
Those change when someone edits their folder.
```

Then build the tools from `createWorkerHireBlocks` and put them in the `agent` flow's catalog. A catalog key is the tool's own name, so wrap each block in a sequencer carrying the name and what the model reads about it. Here a fire waits for a person's approval first:

```ts title="src/workforce.ts"
import { defineCapability, handler, sequencer } from "@flow-state-dev/core";
import {
  createWorkerHireBlocks,
  createWorkerInstallation,
  createWorkforceCapability,
  defineAgentWorkerFlow,
  defineSeatInventoryCollection,
  hireWorkforce,
  projectWritesMailboxInventory,
  workerMailboxPostCapability,
} from "@flow-state-dev/workforce";
import { z } from "zod";

import { coderFlow } from "./flows/coder";
import { roster } from "./roster";

/** A fire waits for the person: a `human_approval` naming the worker. On Deny, nothing changes. */
const askFire = handler({
  name: "ask-fire",
  inputSchema: z.object({ id: z.string() }).passthrough(),
  outputSchema: z.void(),
  execute: async (input, ctx) => {
    if (ctx.suspend === undefined) {
      throw new Error(`firing "${input.id}" waits for a person's approval, and this app can't ask for one. Nothing was changed.`);
    }
    await ctx.suspend({ reason: "human_approval", message: `Fire worker "${input.id}"?`, data: { worker: input.id }, allow: ["approve", "reject"] });
  },
});

const installation = createWorkerInstallation({
  standardWorkers: roster.workers,
  workerFlows: () => ({ coder: coderFlow, agent }),
});

const { hire, fire } = createWorkerHireBlocks(installation);
const rosterTools = {
  hire: sequencer({
    name: "hire",
    description: "Hire a worker of the person's own: `id`, the `flow` it runs on (`agent` when omitted), and `settings`.",
    inputSchema: hire.inputSchema,
    outputSchema: hire.outputSchema,
  }).step(hire),
  fire: sequencer({
    name: "fire",
    description: "Fire one of the person's own workers, by id, once the person approves it.",
    inputSchema: fire.inputSchema,
    outputSchema: fire.outputSchema,
  })
    .tap(askFire)
    .step(fire),
};

// `roster.mailboxes` must already be final here (see the order below).
const agent = defineAgentWorkerFlow({
  installation,
  catalog: rosterTools,
  uses: [
    defineCapability({
      name: "inventory",
      resources: { seatInventory: defineSeatInventoryCollection(), mailboxInventory: projectWritesMailboxInventory },
    }),
    createWorkforceCapability({
      roster: { workers: roster.workers, mailboxes: roster.mailboxes },
      inventory: { seats: "seatInventory", mailboxes: "mailboxInventory" },
    }),
    workerMailboxPostCapability,
  ],
});

export const flows = hireWorkforce(installation);
```

The capabilities on the flow each add one part:

- **Inventory and `discover`.** `createWorkforceCapability` gives every worker on the flow `discover`, which is how the chief of staff answers questions about the roster. The small `inventory` capability declares the seat and mailbox inventories on the flow, the mailbox one with `projectWritesMailboxInventory`, the declaration the [project tools](#starting-projects) need, so you can add them later without touching it. Passing the keys as `inventory` lets `discover` answer who works here and who is in a mailbox.
- **Posting.** `workerMailboxPostCapability` adds `post-to-mailbox`, so the chief of staff can answer in a mailbox it is a member of, signed as the worker its turn runs as. A mailbox counts it as a member only when its `MAILBOX.md` `members:` lists it, by its own name for an org-level worker, as in `members: [eng.em, eng.coder, chief-of-staff]`. A post from a worker the mailbox doesn't list is refused with `author-not-a-member`.
- **Hiring.** The catalog holds `hire` and `fire`. Asking first is yours to add, as `askFire` does: the blocks themselves write at once.

Build in this order:

1. Finish any edits or additions to the mailbox records.
2. Build the installation and the `agent` flow above, and call `hireWorkforce`.
3. Build the mailbox kind with `wakeMemberSeats(flows, { installation })`. It comes after `hireWorkforce`, because it takes the flows it returned.
4. Call `mailboxInstances` last.

`createWorkforceCapability` keeps the mailbox records it is given, so a record changed after step 2 never reaches `discover`. Pass `createWorkforceCapability` the same mailbox records you pass `mailboxInstances`, so `discover` answers from the mailboxes the app actually opens.

`hire` asks the model for an id, a flow and `settings`, but doesn't say which flows require which settings. The chief of staff learns that from its `WORKER.md` body, so name each required setting and its value there, as the example file does for `coder`. A hire missing a required setting is refused with the setting named and nothing written, so the model can call `hire` again with it.

In the snippet above, `coderFlow` requires a `document` setting through its `configSchema`: `workerConfigSchema().extend({ document: z.string().min(1) })`.

Putting the tools in the catalog doesn't hand them to every worker on the flow. A worker holds `hire` or `fire` only when its own `tools:` names it, so keep those names in the chief of staff's file and no other.

If your Lab has projects, add `chief-of-staff` to the project template's `seats` (or a team `MAILBOX.md` template's `members:`), so the chief of staff is in every project's room. Build the mailbox kind with `wakeMemberSeats(flows, { installation })` so a post in the room wakes it, and pass the template to `mailboxInstances` as [Setting up the room](./projects.md#setting-up-the-room) shows, including without `fsdev gen`.

A hire is a row in the person's own data, so it is there after a restart on any store that keeps data. Every process sees it on the next turn.

## Starting projects

Ask the chief of staff for a project and it creates one, owned by you. You are always a member, and anyone you name joins you. Your own talk session on the project's room is ready when it answers.

It needs the two project tools, `createProject` and `setWorkstreams`, in its `tools:` line and in the `agent` kind's catalog. [Giving the writes to a seat](./projects.md#giving-the-writes-to-a-seat) shows the catalog entries. Add the names to the file:

```md title="workforce/org/workers/chief-of-staff/WORKER.md"
---
flow: agent
tools: [hire, fire, post-to-mailbox, createProject, setWorkstreams]
---
```

and tell it how to use them in the body, for example:

```md
When the person asks for a project, call `createProject` with the title they
gave and a short lowercase `id` made from it. They own it and are always a
member; put anyone else they name in `members`. Add workstreams only when they
name them, by full mailbox id.
```

The `inventory` capability from [Adding one](#adding-one) is the inventory declaration the project tools read. Don't add a second one, such as a `defineMailboxInventoryCollection()` of your own: [Giving the writes to a seat](./projects.md#giving-the-writes-to-a-seat) shows the error the kind throws.

A workstream belongs to one project at most. When the person asks for one another project holds, the tool is refused, and the chief of staff can tell them which project has it.

## The tools

| Tool | What it does | Asks first |
| --- | --- | --- |
| `hire` | Hires a worker of the person's own, on a worker flow your app runs, under the id it is given | Only when you wrap it with an ask |
| `fire` | Removes one of the person's own workers. Its sessions stay readable to them | Only when you wrap it with an ask, as above |
| `createProject` | Creates a project owned by the person asking, with the members and workstreams they name | Never |
| `setWorkstreams` | Replaces a project's workstreams. The person asking must be one of its members | Never |

The roster tools work on the person's own workers. Another member's workers are theirs: the chief of staff can't list or fire them.

## What asks first

A fire wrapped as above pauses the request with a `human_approval` suspension before anything changes:

```json
{
  "reason": "human_approval",
  "message": "Fire worker \"scribe\"?",
  "data": { "worker": "scribe" },
  "allow": ["approve", "reject"]
}
```

The person answers through the resume route, as for any other [durable suspension](../advanced/durable-execution.md):

```bash
curl -X POST localhost:3000/api/flows/agent/requests/$REQUEST_ID/resume \
  -H 'content-type: application/json' \
  -d '{"suspensionId":"'$SUSPENSION_ID'","action":"approve"}'
```

On approve, the fire runs. On reject, nothing changes, and the model is told the request was denied. The ask outlives a restart: a person can approve tomorrow what the chief of staff asked today.

Asking needs durable execution, so turn it on with `durable: true` on `createFlowState`. Without it, the ask above refuses rather than firing unasked:

```text
firing "scribe" waits for a person's approval, and this app can't ask for one. Nothing was changed.
```

Asking also needs a model with the single-step methods: `generateStep`, and `streamStep` when it streams. Models from the built-in AI SDK adapter have them. On a custom model without them, or a fallback group none of whose models has them, the tool can't pause the request: the call fails before anything changes, the model is told the tool failed, and the turn carries on with no approval raised. [Suspending inside generators](../advanced/generator-and-router-suspend-resume.md) covers a pause inside a tool call.

The roster flow's own `fire` action, which an app sends directly, never asks: an app that sends it already has the person's say-so.

## What it can't do

- **Fire itself, or any declared worker.** A worker declared in a worker file is a standard worker; `fire` refuses it, and it changes when someone edits its folder.
- **Hire under a standard worker's id.** A hire that reuses one is refused, suggesting a fork instead.
- **Hire onto a flow your app doesn't run workers on, or keeps for standard workers.** The refusal names the flow.
- **Reach another member's workers.** Their roster is theirs.
- **Open, close or rename a mailbox.** Mailboxes are declared on disk.
