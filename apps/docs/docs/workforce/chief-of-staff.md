---
title: The chief of staff
sidebar_position: 12
sidebar_label: Chief of staff
description: "An org-level worker that hires workers of your own and, as a coordinator, hands your work to its delegates. It can start projects, and with the approval step below, a fire waits for your approval."
---

# The chief of staff

The chief of staff is an org-level worker a person talks to about the organization itself and about getting work done. Set up as below, it's a [coordinator](./coordinators.md) that routes by judgment: it decides who gets each thing you ask, and it can answer you itself.

With the instructions below, it:

- looks up who works here, or who is in a mailbox, when you ask;
- reads your conversation's [delegates](./coordinators.md#changing-the-delegates) when you ask who they are;
- hands work to the delegate that does it, and the delegate's answer lands in your conversation under its name;
- hires a worker of your own when no delegate does the work, adds it as a delegate, and hands the work on;
- puts a fire in front of you, with the approval step shown below, and removes nothing until you approve;
- starts [projects](./projects.md) for you, once you give it the project tools.

A worker it hires belongs to the person it is talking to: it is on their roster and nobody else's, as [Hiring and forking](./durable-hire.md) describes. A Lab that doesn't declare a chief of staff doesn't have one.

A chief of staff can also run on the built-in `agent` flow. It then answers and changes your roster the same way, but has no delegates and hands nothing on. Name `flow: agent`, leave `routing:` and `delegates:` out (the `agent` flow refuses settings it doesn't declare), and give the `agent` flow the catalog and capabilities shown below.

Shift Manager's [`devteam` profile](../shift-manager/overview.md#the-devteam-profile) ships one on the `coordinator` flow.

## Adding one

Add a `WORKER.md` for the worker, and build the `coordinator` flow with the hire and fire tools in its catalog.

There's no switch for it: a chief of staff is a worker your files declare, like any other.

The file goes under `org/workers/`, beside `teams/`. Its folder name is its id, so `org/workers/chief-of-staff/` is the worker `chief-of-staff`. It runs on the `coordinator` flow, routes by judgment, and names the delegates each conversation starts with and the tools it holds:

```md title="workforce/org/workers/chief-of-staff/WORKER.md"
---
description: Your one point of contact, and the one worker that changes your roster.
flow: coordinator
routing: judgment
delegates: [eng.em, eng.coder]
model: openai/gpt-5.4-mini
tools: [hire, fire, post-to-mailbox]
---

You are the chief of staff for this organization.

When someone asks who works here or who is in a mailbox, look it up with
`discover` and answer from what it returns.

When they ask who your delegates are, call `listDelegates` and answer from
what it returns. When they ask for work a delegate does, call `handOff` with
that delegate's id. Its answer lands in this conversation under its name, so
don't answer for it. When no delegate does the work, hire a worker for it,
add it with `addDelegate`, and hand it on.

To add a worker for the person, call `hire`. It lands at once. To remove one
of theirs, call `fire`. The person approves every fire before it happens; if
they deny it, say so and don't try again unless they ask.

To hire a worker on `coder`, pass `settings: { "document": "teams/eng/feature-brief" }`.
A worker on `agent` needs no settings, and is the one to hire for work you hand off.

You can't fire yourself or any worker declared in the organization's files.
Those change when someone edits their folder.
```

`listDelegates`, `addDelegate`, `removeDelegate`, `setFallback` and `handOff` come with the coordinator flow, so `tools:` doesn't name them. A chief of staff declared in your files can name only workers declared in your files in `delegates:`; anything else is refused when the app loads. The workers it hires join a conversation's delegates when it adds them, and only that conversation's. [Changing the delegates](./coordinators.md#changing-the-delegates) covers how a conversation's list changes.

Then build the tools from `createWorkerHireBlocks` and put them in the catalog. A catalog key is the tool's own name, so give `hire` that name with `.as()`, along with what the model reads about it. A fire waits for a person's approval first, so `fire` is a sequencer that asks before it writes. The chief of staff's `tools:` line is read against the catalog you pass `defineCoordinatorFlow` as `agent`, so the tools and capabilities go there. The example passes the same options to the `agent` flow, which runs the workers the chief of staff hires; that part is optional, and gives those workers the same capabilities:

```ts title="src/workforce.ts"
import { defineCapability, handler, sequencer } from "@flow-state-dev/core";
import {
  createWorkerHireBlocks,
  createWorkerInstallation,
  createWorkforceCapability,
  defineAgentWorkerFlow,
  defineCoordinatorFlow,
  defineSeatInventoryCollection,
  hireWorkforce,
  projectWritesMailboxInventory,
  workerMailboxPostCapability,
} from "@flow-state-dev/workforce";
import { z } from "zod";

import { coderFlow } from "./flows/coder";
import { emFlow } from "./flows/em";
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
  workerFlows: () => ({
    em: { flow: emFlow, standardOnly: true },
    coder: coderFlow,
    agent,
    coordinator: { flow: coordinator, standardOnly: true },
  }),
});

const { hire, fire } = createWorkerHireBlocks(installation);
const rosterTools = {
  hire: hire.as({
    name: "hire",
    description: "Hire a worker of the person's own: `id`, the `flow` it runs on (`agent` when omitted), and `settings`.",
  }),
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
const agentTurn = {
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
};

const agent = defineAgentWorkerFlow({ installation, ...agentTurn });

// The chief of staff's flow. Its own turn reads `tools:` against `agentTurn.catalog`.
const coordinator = defineCoordinatorFlow({
  installation,
  delegateFlows: [agent, emFlow],
  routeModel: "openai/gpt-5.4-mini",
  agent: agentTurn,
});

export const flows = hireWorkforce(installation);
```

`emFlow` is a worker flow of your own that takes a delegated post, as [Making your own flow a delegate](./coordinators.md#making-your-own-flow-a-delegate) shows, so it goes in `delegateFlows`. `coderFlow` takes tasks, not posts: `eng.coder` works the rows on a board, which is enough to be listed as a delegate, but a post handed to it is skipped, and the [routing record](./coordinators.md#what-it-records) says why. `routeModel` is required even though the chief of staff routes by judgment; only a coordinator on `best-fit` calls it.

The capabilities each add one part:

- **Inventory and `discover`.** `createWorkforceCapability` gives every worker on both flows `discover`, which is how the chief of staff answers questions about the roster. The small `inventory` capability declares the seat and mailbox inventories on both flows. The mailbox one uses `projectWritesMailboxInventory`, the declaration the [project tools](#starting-projects) need, so you can add them later without touching it. Passing the keys as `inventory` lets `discover` answer who works here and who is in a mailbox.
- **Posting.** `workerMailboxPostCapability` adds `post-to-mailbox`, so the chief of staff can post in a mailbox it is a member of, signed as the worker its turn runs as. A mailbox counts it as a member only when its `MAILBOX.md` `members:` lists it, by its own name for an org-level worker, as in `members: [eng.em, eng.coder, chief-of-staff]`. A post from a worker the mailbox doesn't list is refused with `author-not-a-member`.
- **Hiring.** The catalog holds `hire` and `fire`. Asking first is yours to add, as `askFire` does: the blocks themselves write at once.

Build in this order:

1. Finish any edits or additions to the mailbox records.
2. Build the installation and the `agent` and `coordinator` flows above, and call `hireWorkforce`.
3. Build the mailbox kind with `wakeMemberSeats(flows, { installation })`. It comes after `hireWorkforce`, because it takes the flows it returned.
4. Call `mailboxInstances` last.

`createWorkforceCapability` keeps the mailbox records it is given, so a record changed after step 2 never reaches `discover`. Pass `createWorkforceCapability` the same mailbox records you pass `mailboxInstances`, so `discover` answers from the mailboxes the app actually opens.

`hire` asks the model for an id, a flow and `settings`, but doesn't say which flows it can hire onto or which settings each one requires. The chief of staff learns both from its `WORKER.md` body, so name the flows it hires onto there, and each required setting and its value, as the example file does for `agent` and `coder`. Without them, the model may ask the person which flow to use instead of calling `hire`. A hire missing a required setting is refused with the setting named and nothing written, so the model can call `hire` again with it.

In the snippet above, `coderFlow` requires a `document` setting through its `configSchema`: `workerConfigSchema().extend({ document: z.string().min(1) })`.

Every flow in `workerFlows` can take a hire, and so can the built-in `agent`, unless its entry is marked `standardOnly: true`. Leave a flow open to hires only when a person should be able to get a worker on it by asking. Mark the rest, such as a flow only your declared workers run or one that exists for tests. The example marks `em` and `coordinator`, so the chief of staff hires onto `agent` and `coder` only. [Which flows can run workers](./workers-on-disk.md#which-flows-can-run-workers) shows the mark. A hire onto a marked flow is refused, and the refusal names the flow.

Putting the tools in the catalog doesn't hand them to every worker on either flow. A worker holds `hire` or `fire` only when its own `tools:` names it, so keep those names in the chief of staff's file and no other.

A post in a mailbox or a project's room doesn't wake a chief of staff on the `coordinator` flow, even when it is listed there: that flow doesn't hear mailbox posts, so [`wakeMemberSeats`](./mailboxes.md#waking-agent-seats) hands that delivery to the notify block you pass as its `fallback`, if you pass one. Listing it in a mailbox's `members:` lets it post there. To have a worker answer every post in a project's room, name one on the `agent` kind in the template's `seats`, as [Setting up the room](./projects.md#setting-up-the-room) shows.

A hire is a row in the person's own data, so it is there after a restart on any store that keeps data. Every process sees it on the next turn.

## Starting projects

Ask the chief of staff for a project and it creates one, owned by you. You are always a member, and anyone you name joins you. Your own talk session on the project's room is ready when it answers.

It needs the project tools in its `tools:` line and in `agentTurn.catalog`: `createProject` and `setWorkstreams`, plus `setRepository` if it should also name the [repository](./projects.md#a-projects-code-and-files) a project's code lives in. [Giving the writes to a seat](./projects.md#giving-the-writes-to-a-seat) shows the catalog entries for the first two, and `setRepository` goes in the same way. Add the names to the file:

```md title="workforce/org/workers/chief-of-staff/WORKER.md"
---
flow: coordinator
tools: [hire, fire, post-to-mailbox, createProject, setWorkstreams, setRepository]
---
```

and tell it how to use them in the body, for example:

```md
When the person asks for a project, call `createProject` with the title they
gave and a short lowercase `id` made from it. They own it and are always a
member; put anyone else they name in `members`. Add workstreams only when they
name them, by full mailbox id.
```

The `devteam` profile's chief of staff holds all three.

The `inventory` capability from [Adding one](#adding-one) is the inventory declaration the project tools read. Don't add a second one, such as a `defineMailboxInventoryCollection()` of your own: [Giving the writes to a seat](./projects.md#giving-the-writes-to-a-seat) shows the error the kind throws.

A workstream belongs to one project at most. When the person asks for one another project holds, the tool is refused, and the chief of staff can tell them which project has it.

## The tools

| Tool | What it does | Asks first |
| --- | --- | --- |
| `hire` | Hires a worker of the person's own, on a worker flow your app runs, under the id it is given | Only when you wrap it with an ask |
| `fire` | Removes one of the person's own workers. Its sessions stay readable to them | Only when you wrap it with an ask, as above |
| `createProject` | Creates a project owned by the person asking, with the members and workstreams they name | Never |
| `setWorkstreams` | Replaces a project's workstreams. The person asking must be one of its members | Never |
| `setRepository` | Sets the repository a project's code lives in, or clears it with `null`. The person asking must be one of its members | Never |

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
curl -X POST localhost:3000/api/flows/coordinator/requests/$REQUEST_ID/resume \
  -H 'content-type: application/json' \
  -d '{"suspensionId":"'$SUSPENSION_ID'","action":"approve"}'
```

On approve, the fire runs. On reject, nothing changes, and the model is told the request was denied. The ask outlives a restart: a person can approve tomorrow what the chief of staff asked today.

Asking needs durable execution, so turn it on with `durable: true` on `createFlowState`. Without it, the ask above refuses rather than firing unasked:

```text
firing "scribe" waits for a person's approval, and this app can't ask for one. Nothing was changed.
```

Asking also needs a model with the single-step methods: `generateStep`, and `streamStep` when it streams. Models from the built-in AI SDK adapter have them. On a custom model without them, or a fallback group none of whose models has them, the tool can't pause the request: the call fails before anything changes, the model is told the tool failed, and the turn carries on with no approval raised. [Suspending inside generators](../advanced/generator-and-router-suspend-resume.md) covers a pause inside a tool call.

The roster flow's own `fire` action, which an app sends directly, never asks. Get the person's approval before you send it.

## What it can't do

- **Fire itself, or any declared worker.** A worker declared in a worker file is a standard worker; `fire` refuses it, and it changes when someone edits its folder.
- **Hire under a standard worker's id.** A hire that reuses one is refused, suggesting a fork instead.
- **Hire onto a flow your app doesn't run workers on, or keeps for standard workers.** The refusal names the flow.
- **Reach another member's workers.** Their roster is theirs.
- **Open, close or rename a mailbox.** Mailboxes are declared on disk.
