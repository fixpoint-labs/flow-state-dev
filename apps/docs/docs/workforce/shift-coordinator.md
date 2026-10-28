---
title: The Shift Coordinator
sidebar_position: 12
sidebar_label: Shift Coordinator
description: "An org-level worker that hires workers of your own and, as a coordinator, hands your work to its delegates. It can start projects, and with the approval step below, a fire waits for your approval."
---

# The Shift Coordinator

The Shift Coordinator is an org-level worker a user talks to about the organization itself and about getting work done. Set up as below, it's a [coordinator](./coordinators.md) that routes by judgment: it decides who gets each thing you ask, and it can answer you itself. To send plain requests straight to the delegate that does them, route it by best fit instead, as [Sending plain requests straight to a delegate](#sending-plain-requests-straight-to-a-delegate) shows.

With the instructions below, it:

- looks up who works here when you ask;
- reads your conversation's [delegates](./coordinators.md#changing-the-delegates) when you ask who they are;
- hands work to the delegate that does it, and the delegate's answer lands in your conversation under its name;
- hires a worker of your own when no delegate does the work, adds it as a delegate, and hands the work on;
- puts a fire in front of you, with the approval step shown below, and removes nothing until you approve;
- starts [projects](./projects.md) for you, once you give it the project tools.

A worker it hires belongs to the user it is talking to: it is on their roster and nobody else's, as [Hiring and forking](./durable-hire.md) describes. A Lab that doesn't declare a Shift Coordinator doesn't have one.

A Shift Coordinator can also run on the built-in `agent` flow. It then answers and changes your roster the same way, but has no delegates and hands nothing on. Name `flow: agent`, leave `routing:` and `delegates:` out (the `agent` flow refuses settings it doesn't declare), and give the `agent` flow the catalog and capabilities shown below.

Shift Manager's [`devteam` profile](../shift-manager/from-a-checkout.md#the-devteam-profile) ships one on the `coordinator` flow.

## Adding one

Add a `WORKER.md` for the worker, and build the `coordinator` flow with the hire and fire tools in its catalog.

There's no switch for it: a Shift Coordinator is a worker your files declare, like any other.

The file goes under `org/workers/`, beside `teams/`. Its folder name is its id, so `org/workers/chief-of-staff/` is the worker `chief-of-staff`. It runs on the `coordinator` flow, routes by judgment, and names the delegates each conversation starts with and the tools it holds:

```md title="workforce/org/workers/chief-of-staff/WORKER.md"
---
description: Your one point of contact, and the one worker that changes your roster.
flow: coordinator
routing: judgment
delegates: [eng.em, eng.coder]
editsOwnDelegates: true
model: openai/gpt-6-luna
tools: [hire, fire]
---

You are the Shift Coordinator for this organization.

When someone asks who works here, look it up with `discover` and answer
from what it returns.

When they ask who your delegates are, call `listDelegates` and answer from
what it returns. When they ask for work a delegate does, call `createTask` with
that delegate as `assignee`, a short `goal`, `session: "ongoing"` and
`resultTo: "conversation"`. Its answer lands in this conversation under its
name, so don't answer for it. When no delegate does the work, hire a worker for it,
add it with `addDelegate`, and hand it on.

To add a worker for the user, call `hire`. It lands at once. To remove one
of theirs, call `fire` as soon as they ask. Don't ask them to confirm in chat
first: `fire` asks them for approval itself, and nothing is removed until they
approve. If they deny it, say so and don't try again unless they ask.

To hire a worker on `coder`, pass `settings: { "document": "teams/eng/feature-brief" }`.
A worker on `agent` needs no settings, and is the one to hire for work you dispatch.

You can't fire yourself or any worker declared in the organization's files.
Those change when someone edits their folder.
```

`listDelegates` and the task tools come with the coordinator flow, and `editsOwnDelegates: true` adds `addDelegate`, `removeDelegate` and `setFallback`, so `tools:` doesn't name them. Without that line, the Shift Coordinator can hire a worker but can't add it to its delegates: only you can, from your app. A Shift Coordinator declared in your files can name only workers declared in your files in `delegates:`; anything else is refused when the app loads. The workers it hires join a conversation's delegates when it adds them, and only that conversation's. [Changing the delegates](./coordinators.md#changing-the-delegates) covers how a conversation's list changes.

Then build the tools from `createWorkerHireBlocks` and put them in the catalog. A catalog key is the tool's own name, so give `hire` that name with `.as()`, along with what the model reads about it. A fire waits for a user's approval first, so `fire` is a sequencer that asks before it writes. The Shift Coordinator's `tools:` line is read against the catalog you pass `defineCoordinatorFlow` as `agent`, so the tools and capabilities go there. The example passes the same options to the `agent` flow, which runs the workers the Shift Coordinator hires; that part is optional, and gives those workers the same capabilities:

```ts title="src/workforce.ts"
import { defineCapability, handler, sequencer } from "@flow-state-dev/core";
import {
  createWorkerHireBlocks,
  createWorkerInstallation,
  createWorkforceCapability,
  defineAgentWorkerFlow,
  defineCoordinatorFlow,
  defineWorkerInventoryCollection,
  hireWorkforce,
} from "@flow-state-dev/workforce";
import { z } from "zod";

import { coderFlow } from "./flows/coder";
import { emFlow } from "./flows/em";
import { roster } from "./roster";

/** A fire waits for the user: a `user_approval` naming the worker. On Deny, nothing changes. */
const askFire = handler({
  name: "ask-fire",
  inputSchema: z.object({ id: z.string() }).passthrough(),
  outputSchema: z.void(),
  execute: async (input, ctx) => {
    if (ctx.suspend === undefined) {
      throw new Error(`firing "${input.id}" waits for a user's approval, and this app can't ask for one. Nothing was changed.`);
    }
    await ctx.suspend({ reason: "user_approval", message: `Fire worker "${input.id}"?`, data: { worker: input.id }, allow: ["approve", "reject"] });
  },
});

const installation = createWorkerInstallation({
  standardWorkers: roster.workers,
  workerFlows: () => ({
    em: { flow: emFlow, standardOnly: true, roles: ["contributor", "manager"] },
    coder: { flow: coderFlow, roles: ["contributor"] },
    agent,
    coordinator: { flow: coordinator, standardOnly: true },
  }),
});

const { hire, fire } = createWorkerHireBlocks(installation);
const rosterTools = {
  hire: hire.as({
    name: "hire",
    description: "Hire a worker of the user's own: `id`, the `flow` it runs on (`agent` when omitted), and `settings`.",
  }),
  fire: sequencer({
    name: "fire",
    description: "Fire one of the user's own workers, by id, once the user approves it.",
    inputSchema: fire.inputSchema,
    outputSchema: fire.outputSchema,
  })
    .tap(askFire)
    .step(fire),
};

const agentTurn = {
  catalog: rosterTools,
  uses: [
    defineCapability({
      name: "inventory",
      resources: { workerInventory: defineWorkerInventoryCollection() },
    }),
    createWorkforceCapability({
      roster: { workers: roster.workers },
      inventory: { workers: "workerInventory" },
    }),
  ],
};

const agent = defineAgentWorkerFlow({ installation, ...agentTurn });

// The Shift Coordinator's flow. Its own turn reads `tools:` against `agentTurn.catalog`.
const coordinator = defineCoordinatorFlow({
  installation,
  routeModel: "openai/gpt-6-luna",
  agent: agentTurn,
});

export const flows = hireWorkforce(installation);
```

`emFlow` and `coderFlow` are worker flows of your own. Build each one's `work` entry with [`workerTaskEntry`](./coordinators.md#taking-a-conversations-tasks), as [Making your own flow a delegate](./coordinators.md#making-your-own-flow-a-delegate) shows, and register each as a `contributor`, so `eng.em` and `eng.coder` take the messages the Shift Coordinator routes to them and the tasks it files. `emFlow` files the coder's tasks as well, so it is a `manager` too. A worker on a flow that takes no task can't be one of its delegates. `routeModel` is one value for the coordinator flow, shared by every coordinator on it. It is required even when the Shift Coordinator routes by judgment; only a coordinator on `best-fit` calls it. Set it to `typesafe-ai/jev` to route by best fit with a floor, as the next section shows.

The capabilities each add one part:

- **Inventory and `discover`.** `createWorkforceCapability` gives every worker on both flows `discover`, which answers who works here. The small `inventory` capability declares the worker inventory on both flows, and passing its key as `inventory` points `discover` at it.
- **Hiring.** The catalog holds `hire` and `fire`. Asking first is yours to add, as `askFire` does: the blocks themselves write at once.

`hire` asks the model for an id, a flow and `settings`, but doesn't say which flows it can hire onto or which settings each one requires. The Shift Coordinator learns both from its `WORKER.md` body, so name the flows it hires onto there, and each required setting and its value, as the example file does for `agent` and `coder`. Without them, the model may ask the user which flow to use instead of calling `hire`. A hire missing a required setting is refused with the setting named and nothing written, so the model can call `hire` again with it.

In the snippet above, `coderFlow` requires a `document` setting through its `configSchema`: `workerConfigSchema().extend({ document: z.string().min(1) })`.

Every flow in `workerFlows` can take a hire, and so can the built-in `agent`, unless its entry is marked `standardOnly: true`. Leave a flow open to hires only when a user should be able to get a worker on it by asking. Mark the rest, such as a flow only your declared workers run or one that exists for tests. The example marks `em` and `coordinator`, so the Shift Coordinator hires onto `agent` and `coder` only. [Which flows can run workers](./workers-on-disk.md#which-flows-can-run-workers) shows the mark. A hire onto a marked flow is refused, and the refusal names the flow.

Putting the tools in the catalog doesn't hand them to every worker on either flow. A worker holds `hire` or `fire` only when its own `tools:` names it, so keep those names in the Shift Coordinator's file and no other.

A hire is a row in the user's own data, so it is there after a restart on any store that keeps data. Every process sees it on the next turn.

Nothing has to open a conversation with the Shift Coordinator when your app boots. One starts the first time someone talks to it, through [`ensureWorkerSession`](./coordinators.md#talking-to-it) or Shift Manager's Shift Coordinator screen. A host that opens conversations with its coordinators itself, to test them for example, opens one with the Shift Coordinator the same way, but the Shift Coordinator doesn't need it.

## Sending plain requests straight to a delegate

Routed by judgment, the Shift Coordinator runs a full model turn on everything you ask, even "file this feature for the storefront", which obviously belongs to one delegate. That turn reads its delegates, hands the request on, and writes a line before the delegate answers.

Route it by best fit, with Jev (`typesafe-ai/jev` through Vercel's AI Gateway, an evaluation model that reports how sure it is; see [Evaluation models](../fundamentals/models.md#evaluation-models)) as the coordinator flow's `routeModel`, and one evaluator call decides instead. A plain request goes straight to the delegate, whose answer is the first thing you see. Hiring, firing, starting a project and questions about your team still reach the Shift Coordinator's own turn, because best fit can pick the Shift Coordinator itself:

```diff
  ---
- description: Your one point of contact, and the one worker that changes your roster.
+ description: Your one point of contact. Hires and fires workers, starts projects, and answers questions about your team.
  flow: coordinator
- routing: judgment
+ routing: best-fit
+ minConfidence: 0.7
  delegates: [eng.em, eng.coder]
```

```diff
  const coordinator = defineCoordinatorFlow({
    installation,
-   routeModel: "openai/gpt-6-luna",
+   routeModel: "typesafe-ai/jev",
```

The description is what best fit picks the Shift Coordinator by, so name its jobs there. Anything Jev isn't sure of, below `minConfidence:`, also goes to its turn, which can still hand it on. The trade: a message that turns out to be the Shift Coordinator's own job costs one evaluator call before the turn, and a request sent while a delegate is still working your last one goes to that delegate. [Picking the coordinator, and a confidence floor](./coordinators.md#picking-the-coordinator-and-a-confidence-floor) has the details.

## Starting projects

Ask the Shift Coordinator for a project and it creates one, owned by you, shared with your organization or private to you, as you ask. On a shared project you are always one of its members, and so is anyone you name. It can also open workstreams in a project for you, each led by a worker from your roster.

It needs the project tools in its `tools:` line and in `agentTurn.catalog`: `createProject` and `openWorkstream`, plus `setRepository` if it should also name the [repository](./projects.md#a-projects-code-and-files) a project's code lives in. `openWorkstream` comes from [`defineWorkstreamBlocks`](./projects.md#workstreams), the others from `defineProjectBlocks`. [Giving the writes to a worker](./projects.md#giving-the-writes-to-a-worker) shows the catalog entries. Add the names to the file:

```md title="workforce/org/workers/chief-of-staff/WORKER.md"
---
flow: coordinator
tools: [hire, fire, createProject, openWorkstream, setRepository]
---
```

and tell it how to use them in the body, for example:

```md
When the user asks for a project, call `createProject` with the title they
gave and a short lowercase `id` made from it. They own it and are always a
project member; put anyone else they name in `members`. For a project only they see,
pass `visibility: "private"` and name nobody else. To open a workstream, call
`openWorkstream` with the project's `visibility` and `id`, a short lowercase
`id` for the workstream, its title, and a `lead` from their roster.
```

The `devteam` profile's Shift Coordinator holds these three.

A refused tool call writes nothing, and its refusal names the reason, such as a lead that isn't on the user's roster, or a shared project they aren't a member of. Tell the Shift Coordinator in its body to pass that on.

## Giving it memory

Without [memory](../memory/overview.md), a Shift Coordinator on the `coordinator` flow remembers nothing from one conversation to the next. Add memory to the `agent` option of `defineCoordinatorFlow` only, as below, and leave `agentTurn` alone. The `agent` flow uses `agentTurn` too, so the workers the Shift Coordinator hires onto it get no memory.

```ts title="src/workforce.ts"
// continuing the example above
import { system } from "@flow-state-dev/memory";

const mem = system({
  model: "openai/gpt-6-luna",
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
  digest: true,
});

const coordinator = defineCoordinatorFlow({
  installation,
  routeModel: "openai/gpt-6-luna",
  agent: {
    ...agentTurn,
    catalog: { ...agentTurn.catalog, "memory/recall": mem.tool.recall() },
    uses: [...agentTurn.uses, mem.capability],
    isolateUserState: true,
    afterAnswer: mem.captureFromItems, // leave out for read-side only
  },
});
```

- **`mem.capability`** puts working memory and a rolling digest of earlier conversations into each turn's `<memory>` context.
- **`memory/recall`** is the [recall tool](../memory/recall-tool.md), which searches what memory has stored. The Shift Coordinator holds it only when its `tools:` line names it: `tools: [hire, fire, memory/recall]`.
- **`isolateUserState: true`** keeps what the coordinator remembers per user, separate from that user's other flows. Every worker on this coordinator flow shares that memory. A tier can set its own `flowIsolation` instead, for example to keep episodes here and share semantic facts with the user's other flows: see [Sharing a tier across flows](../memory/configuration.md#sharing-a-tier-across-flows).
- **`afterAnswer`** records each conversation into memory after the Shift Coordinator answers. It runs memory's capture pipeline, which makes extra model calls after every turn. Leave it out and nothing is written: working memory, the digest and `memory/recall` stay empty unless something else in your app stores into that same memory.

Then tell it in the `WORKER.md` body what counts as memory, for example:

```md
Your memory of earlier conversations is what your `<memory>` context shows and
what `memory/recall` finds, and nothing else. The earlier messages of this
conversation, and what your tools return, are things you read now, not
memories. When the user asks about an earlier conversation and your memory
has nothing on it, say you have no memory of it. Never make up a memory.
```

## Coaching it

Tell the Shift Coordinator how you want it to work, on Shift Manager's Shift Coordinator screen or in any conversation with it, and it keeps the note as a [standing rule](./standing-rules.md) for you. Your rules are yours: another user on the same Shift Manager has their own.

## The tools

| Tool | What it does | Asks first |
| --- | --- | --- |
| `hire` | Hires a worker of the user's own, on a worker flow your app runs, under the id it is given | Only when you wrap it with an ask |
| `fire` | Removes one of the user's own workers. Its sessions stay readable to them | Only when you wrap it with an ask, as above |
| `createProject` | Creates a project owned by the user asking, private or shared, with the project members they name | Never |
| `openWorkstream` | Opens a workstream the user asking owns, led by a worker from their roster. On a shared project they must be a project member | Never |
| `setRepository` | Sets the repository a project's code lives in, or clears it with `null`. The user asking must be a project member | Never |
| `rules/read` | Lists the Shift Coordinator's [standing rules](./standing-rules.md) for the user asking, numbered | Never |
| `rules/add` | Adds one standing rule for the user asking | Never |
| `rules/change` | Rewrites one rule, named by its number and its current text | Never |
| `rules/remove` | Drops one rule, named the same way | Never |

The roster tools work on the user's own workers. Another user's workers are theirs: the Shift Coordinator can't list or fire them.

## What asks first

A fire wrapped as above pauses the request with a `user_approval` suspension before anything changes:

```json
{
  "reason": "user_approval",
  "message": "Fire worker \"scribe\"?",
  "data": { "worker": "scribe" },
  "allow": ["approve", "reject"]
}
```

The user answers through the resume route, as for any other [durable suspension](../advanced/durable-execution.md):

```bash
curl -X POST localhost:3000/api/flows/coordinator/requests/$REQUEST_ID/resume \
  -H 'content-type: application/json' \
  -d '{"suspensionId":"'$SUSPENSION_ID'","action":"approve"}'
```

On approve, the fire runs. On reject, nothing changes, and the model is told the request was denied. The ask outlives a restart: a user can approve tomorrow what the Shift Coordinator asked today.

Asking needs durable execution, which is on by default wherever your stores persist. On a host without it (`durable: false`, or in-memory stores), the tool throws an error that names the setting to change, the fire doesn't run, and nothing is changed.

Asking also needs a model with the single-step methods: `generateStep`, and `streamStep` when it streams. Models from the built-in AI SDK adapter have them. On a custom model without them, or a fallback group none of whose models has them, the tool can't pause the request: the call fails before anything changes, the model is told the tool failed, and the turn carries on with no approval raised. [Suspending inside generators](../advanced/generator-and-router-suspend-resume.md) covers a pause inside a tool call.

The roster flow's own `fire` action, which an app sends directly, never asks. Get the user's approval before you send it.

## What it can't do

- **Fire itself, or any declared worker.** A worker declared in a worker file is a standard worker; `fire` refuses it, and it changes when someone edits its folder.
- **Hire under a standard worker's id.** A hire that reuses one is refused, suggesting a fork instead.
- **Hire onto a flow your app doesn't run workers on, or keeps for standard workers.** The refusal names the flow.
- **Reach another user's workers.** Their roster is theirs.
