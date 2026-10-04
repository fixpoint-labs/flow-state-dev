---
title: The chief of staff
sidebar_position: 8.5
sidebar_label: Chief of staff
description: "One seat a person asks who works here, and asks to change it. Hires land at once; a fire waits for the person's approval. It can also start projects."
---

# The chief of staff

The chief of staff is a seat a person talks to about the organization itself. Ask it who works here or who is on a channel, and it looks it up. Ask it for another seat, and it hires one. Ask it for one fewer, and it puts the fire in front of you to approve. Nothing is removed until you do. Give it the project tools, and it starts [projects](./projects.md) for you too.

With `refuseRosterAdmin` on, as in the setup below, it is the only seat that hires or fires. Another seat that needs help sends the chief of staff a message and lets it decide. A Lab that doesn't declare one doesn't have one.

## Adding one

You need two things: a `WORKER.md` for the seat, and the `seat-hire` tools on the kind it runs on.

The file goes under `org/workers/`, beside `teams/`. Its folder name is its id, so `org/workers/chief-of-staff/` is the seat `chief-of-staff`. It runs on the built-in `agent` kind and names the tools it holds:

```md title="workforce/org/workers/chief-of-staff/WORKER.md"
---
description: Who works here, and the one seat that changes it.
flow: agent
model: openai/gpt-5.4-mini
tools: [hire, fire, rehire, brokenSeats, post-to-channel]
---

You are the chief of staff for this organization.

When someone asks who works here or who is on a channel, look it up with
`discover` and answer from what it returns.

To add a seat, call `hire`. It lands at once. To remove one, call `fire`.
The person approves every fire before it happens; if they deny it, say so
and don't try again unless they ask.

You can't fire yourself or any seat declared in the organization's files.
Those change when someone edits their folder.
```

Then give the `agent` kind the tools, with `askBefore: ["fire"]` so a fire waits for a person, and `refuseRosterAdmin: true` so a seat it hires can't be handed the same tools:

```ts title="src/workforce.ts"
import { defineCapability } from "@flow-state-dev/core";
import {
  channelPostCapability,
  createSeatHireCapability,
  createWorkforceCapability,
  defineAgentWorkerFlow,
  defineChannelInventoryCollection,
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE,
  type HireOptions,
} from "@flow-state-dev/workforce";

import { deskClerkFlow } from "./flows/desk-clerk";
import { instanceAt, kindAt, registerSeat, releaseSeat } from "./registry-access";
import { roster } from "./roster";

// Typed as the whole map, so the `agent` entry can be added below.
export const kinds: NonNullable<HireOptions["kinds"]> = { "desk-clerk": deskClerkFlow };

const seatHire = createSeatHireCapability({
  kinds,
  register: registerSeat,
  unregister: releaseSeat,
  kindAt,
  instanceAt,
  allowKinds: ["desk-clerk", "agent"],
  askBefore: ["fire"],
  refuseRosterAdmin: true,
});

kinds.agent = defineAgentWorkerFlow({
  uses: [
    defineCapability({
      name: "channel-inventory",
      resources: { channelInventory: defineChannelInventoryCollection() },
    }),
    createWorkforceCapability({
      roster: { workers: roster.workers, channels: roster.channels },
      inventory: { seats: SEAT_INVENTORY_RESOURCE, channels: "channelInventory" },
      hiredRoster: HIRED_ROSTER_RESOURCE,
    }),
    channelPostCapability,
    seatHire,
  ],
});
```

Add `kindAt` and `instanceAt` to the `registry-access.ts` from [Reaching the `FlowState`](./durable-hire.md#reaching-the-flowstate), next to `registerSeat` and `releaseSeat`. They use the `FlowInstance` and `FlowState` imports already in the file:

```ts title="src/flows/workforce-admin/registry-access.ts"
let registry: Awaited<ReturnType<FlowState["getRuntime"]>>["registry"] | undefined;

/** Call once, right after `createFlowState`, alongside `useFlowState`. */
export async function useRegistry(next: FlowState): Promise<void> {
  registry = (await next.getRuntime()).registry;
}

export const kindAt = (address: string): string | undefined => registry?.get(address)?.kind;
export const instanceAt = (address: string): FlowInstance | undefined => registry?.get(address);
```

`kindAt(address)` returns the kind of the flow registered at that address, or `undefined`; the hire tools use it to refuse a declared seat by name. `instanceAt(address)` returns the flow instance registered there, or `undefined`. The hire tools use it to tell a seat they minted apart from another seat at the same address, so a re-hire interrupted by a restart completes, and `fire` releases only its own seat.

Both read nothing until `useRegistry` has run, so call it where you call `useFlowState`:

```ts
const app = createFlowState(/* ... */);
useFlowState(app);
await useRegistry(app);
```

`createWorkforceCapability` gives every seat on the kind `discover`, which is how the chief of staff answers questions about the roster. The small `channel-inventory` capability declares the channel inventory as a resource on the kind, and passing its key, `channelInventory` here, as `inventory.channels` lets `discover` answer who is on a channel too. `channelPostCapability` adds `post-to-channel`, so the chief of staff can answer in a channel it is a member of. `createSeatHireCapability` takes the same options as [`createSeatHireBlocks`](./durable-hire.md#the-ready-made-hire-and-fire-handlers), plus `askBefore`.

Installing the tools on a kind doesn't hand them to every seat of it. A seat holds `hire` or `fire` only when its own `tools:` names it, so keep those names in the chief of staff's file and no other. `refuseRosterAdmin: true` keeps them out of the seats the chief of staff hires, too. Leave it off and a hire may name them like any other tool.

If your Lab has projects, add `chief-of-staff` to the project template's `seats` (or a team `CHANNEL.md` template's `members:`), so the chief of staff is in every project's room. Build the channel kind with `wakeMemberSeats(seats)` so a post in the room wakes it, and pass the template to `channelInstances` as [A room per project](./channels.md#a-room-per-project) shows, including without `fsdev gen`.

Read the seats it hired back when the app starts, as in [Reading the roster back at the next start](./durable-hire.md#reading-the-roster-back-at-the-next-start), and serve the app over a store that survives a restart. Otherwise a hire lasts only as long as the process.

## Starting projects

Ask the chief of staff for a project and it creates one, owned by you. You are always a member, and anyone you name joins you. Your own talk session on the project's room is ready when it answers.

It needs the two project tools, `createProject` and `setWorkstreams`, in its `tools:` line and in the `agent` kind's catalog. [Giving the writes to a seat](./projects.md#giving-the-writes-to-a-seat) shows the catalog entries. Add the names to the file:

```md title="workforce/org/workers/chief-of-staff/WORKER.md"
---
flow: agent
tools: [hire, fire, rehire, brokenSeats, post-to-channel, createProject, setWorkstreams]
---
```

and tell it how to use them in the body, for example:

```md
When the person asks for a project, call `createProject` with the title they
gave and a short lowercase `id` made from it. They own it and are always a
member; put anyone else they name in `members`. Add workstreams only when they
name them, by full channel id.
```

If the kind's `discover` reads channels too, declare its channel inventory with `projectWritesChannelInventory`, as that section shows. The project tools read the same collection, and the kind refuses a second declaration of it.

A workstream belongs to one project at most. When the person asks for one another project holds, the tool is refused, and the chief of staff can tell them which project has it.

## The tools

| Tool | What it does | Asks first |
| --- | --- | --- |
| `hire` | Hires a seat on a kind in `allowKinds`, under the id it is given | Only when `askBefore` lists `"hire"` |
| `fire` | Removes a seat this organization hired: its roster row, its address and its inventory row | Only when `askBefore` lists `"fire"` |
| `brokenSeats` | Lists hired seats that would not start, each with its reason. Reads only | Never |
| `rehire` | Keeps a seat that no longer starts at its address, on a kind this app carries | Always |
| `createProject` | Creates a project owned by the person asking, with the members and workstreams they name | Never |
| `setWorkstreams` | Replaces a project's workstreams. The person asking must be one of its members | Never |

The seat tools work on the organization's seats. A seat a member hired for only themselves stays with that member, and the chief of staff can't list, repair or fire it.

## What asks first

`askBefore` lists the changes that wait for a person. It takes `"hire"` and `"fire"`, and any other entry throws when the capability is built:

```text
askBefore names "promote"; it takes hire and fire.
```

`askBefore` covers `hire` and `fire` only. Left out, those two act at once. `rehire` is not on the list because it always asks, whatever `askBefore` says, so a repair needs durable execution even in an app that asks for nothing else.

A listed tool checks everything that could refuse the change first. A seat id nothing hired, a seat declared in a file, or a kind outside `allowKinds` is refused straight away, and nobody is asked. When the change could go ahead, the tool pauses the request with a `human_approval` suspension:

```json
{
  "reason": "human_approval",
  "message": "Fire seat \"coder-7\" (kind \"coder\")?",
  "data": { "verb": "fire", "seatId": "coder-7", "kind": "coder", "owner": null, "incarnation": "3f9c2a6e-5b1d-4e8a-9c07-2d4e6b8a1f53" },
  "allow": ["approve", "reject"]
}
```

The person answers through the resume route, as for any other [durable suspension](../advanced/durable-execution.md):

```bash
curl -X POST localhost:3000/api/flows/chief-of-staff/requests/$REQUEST_ID/resume \
  -H 'content-type: application/json' \
  -d '{"suspensionId":"'$SUSPENSION_ID'","action":"approve"}'
```

`owner` is the member whose own seat it is, or `null` for an organization's seat. `incarnation` names the hire that wrote the row.

On approve, the tool checks again and makes the change, to that row only. If the seat was fired and hired again under the same id while the person was asked, the approved change is refused, the new seat is left alone, and the model gets this as the tool's error:

```text
The seat "acme.coder-7" changed while you were asked: it is not the one you approved, so the fire was not made. Ask again if it should be.
```

On reject, nothing changes, and the model is told the request was denied. The ask outlives a restart: a person can approve tomorrow what the chief of staff asked today. On a store that keeps a run as it goes, such as SQLite, a process that dies after the approval and before the turn ends makes the change once when the request is recovered.

Asking needs durable execution, so turn it on with `durable: true` on `createFlowState`. Without it, a listed tool refuses rather than acting unasked:

```text
"fire" waits for a person's approval here, and this app can't ask for one: it runs without durable execution. Nothing was changed.
```

Asking also needs a model with the single-step methods: `generateStep`, and `streamStep` when it streams. Models from the built-in AI SDK adapter have them. On a custom model without them, or a fallback group none of whose models has them, the listed tool can't pause the request: the call fails before anything changes, the model is told the tool failed, and the turn carries on with no approval raised. [Suspending inside generators](../advanced/generator-and-router-suspend-resume.md) covers a pause inside a tool call.

`askBefore` applies to the tools a model calls. The handlers [`createSeatHireBlocks`](./durable-hire.md#the-ready-made-hire-and-fire-handlers) returns, mounted as actions, never ask.

## What it can't do

- **Fire itself, or any declared seat.** `fire` answers that a seat declared in a worker file is removed by editing its folder.
- **Hire under a declared seat's id.** A hire that reuses one is refused, naming the kind already there.
- **Hire a kind outside `allowKinds`.** The refusal lists the kinds it may hire.
- **Hire another seat that can hire, when `refuseRosterAdmin` is on.** A hire or re-hire whose settings name `hire`, `fire`, `rehire` or `brokenSeats` in `tools:`, or pick the `seat-hire` capability under `capabilities:`, is refused, whatever the kind. Roster admin stays with the seats your app declares.
- **Open, close or rename a channel.** Channels are declared on disk.
