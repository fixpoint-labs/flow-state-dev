---
title: Live Inventory
sidebar_position: 5
sidebar_label: Live Inventory
description: "What is actually open right now. The declared tree says what a workforce is meant to be; the inventory holds what is: one row per seat, one row per open channel, and one row per seat-in-channel."
---

# Live Inventory

The tree tells you what a workforce is meant to be. A `WORKER.md` declares a seat. A `CHANNEL.md` declares a channel. Both are read once at boot. Neither answers what is open right now, which channels a seat is in, or whether a channel ever opened at all. A block cannot walk folders to find out.

The inventory holds those answers as data: three org-scoped resource collections that a block reads the way it reads any other resource.

| Collection | One row per | Key |
|------------|-------------|-----|
| Seats | registered seat | `inventory/seats/<seatId>` |
| Channels | open channel | `inventory/channels/<channelId>` |
| Memberships | seat-in-channel | `inventory/members/<seatId>/<channelId>` |

## When to use which source

**Where the seat exists:** the tree (the `WORKER.md` folder).

**Where the channel is declared:** the tree (the `CHANNEL.md` folder).

**Which channels exist in this org right now:** the inventory.

**Which seats is this channel open to:** the inventory's channel row, which holds `members`.

**Which channels is this seat in:** the inventory's membership index.

The two layers answer two different questions and join on one thing: the `id`.

**Who may post to a channel:** the channel itself, checking its own session state. The `post` and `fileTask` blocks read `members` from the channel's session, not from the inventory. A caller asking whether a seat's post will be accepted asks the channel; the inventory's `members` is a copy for finding things, not the check.

## Wiring the boot

The inventory is written by actions that run inside flows, not by a standalone call. That means the rows are written at boot, after flows are registered and channels are open.

```ts
import {
  channelInstances,
  hireWorkforce,
  openChannels,
  openInventory,
} from "@flow-state-dev/workforce";

const seats = hireWorkforce(roster.workers);
const instances = channelInstances(roster.channels, { inventory: true });

flowRegistry.registerMany([...seats, ...instances]);
// server starts here

await openChannels(roster.channels, {
  client: sessionClient,
  userId: "u_boot",
  orgId: "org_acme",
});

await openInventory(
  { seats, channels: roster.channels },
  {
    run,
    seatWriter: { flowKind: "channel" },
    userId: "u_boot",
    orgId: "org_acme",
  }
);
```

The writer needs both halves:

1. `channelInstances(roster.channels, { inventory: true })` builds the built-in kind carrying the registration actions and the three collections.
2. `openInventory(...)` runs those actions: once per channel, once for all seats.

Leave both out and channels work without an inventory. Nothing is declared, nothing is written, and the three collection factories return collections whose keys resolve empty.

### The action door

`run` is your app's door into a flow. It takes the action request `openInventory` builds, runs it through your runtime, and rejects when the action fails:

```ts
const run = async (request) => {
  const result = await runAction({
    flow: byKind[request.flowKind],
    actionName: request.action,
    input: request.input,
    userId: request.userId,
    orgId: request.orgId,
    sessionId: request.sessionId,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  });
  if (result?.error !== undefined) {
    throw result.error instanceof Error ? result.error : new Error(String(result.error));
  }
  return result;
};
```

The rejection matters. A door that hands back a failed run as an ordinary value reports every channel registered while writing nothing.

### Where the seat rows go

Seat rows need a flow to run in, because a resource collection can only be written from inside a flow. Any flow carrying `inventoryWriterActions` will do. A channel kind built with `inventory: true` does, so `seatWriter: { flowKind: "channel" }` is the usual line. An app that has no channels, or whose channels run a kind of its own, names whichever flow carries the writer.

## Reading the inventory

Declare the same collections on any block. They return the same rows, because a collection is addressed by its pattern and scope, never by object identity.

```ts
import {
  defineChannelInventoryCollection,
  defineMembershipIndexCollection,
  defineSeatInventoryCollection,
  membershipPrefix,
} from "@flow-state-dev/workforce";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const seats = defineSeatInventoryCollection();
const channels = defineChannelInventoryCollection();
const memberships = defineMembershipIndexCollection();

const seatChannels = handler({
  name: "seat-channels",
  inputSchema: z.object({ seatId: z.string() }),
  outputSchema: z.object({ channelIds: z.array(z.string()) }),
  resources: { memberships },
  execute: async (input, ctx) => {
    const rows = await ctx.resources.memberships.list(membershipPrefix(input.seatId));
    return { channelIds: rows.map((row) => row.state.channelId) };
  },
});
```

`list()` hands back resource refs. The row is on `ref.state`.

### What each row holds

**Seat:**

```ts
{ id: "engineering.lead", kind: "agent" }
```

**Channel:**

```ts
{
  id: "engineering.standup",
  kind: "channel",
  members: ["engineering.lead", "engineering.analyst"],
  openedAt: "2026-09-19T09:14:07.123Z"
}
```

**Membership:**

```ts
{ seatId: "engineering.lead", channelId: "engineering.standup" }
```

`openedAt` is an ISO timestamp set the first time the channel registers and left alone after. `members` is what the channel's session holds, not what the roster declared.

## Writing from your own kind

A channel kind you wrote yourself gets rows when it carries the writer. Spread `inventoryWriterActions` into its `actions` the way it already carries `cardinality: "singleton"`:

```ts
import { defineFlow } from "@flow-state-dev/core";
import {
  channelSessionStateSchema,
  inventoryWriterActions,
} from "@flow-state-dev/workforce";

const briefingKind = defineFlow({
  kind: "briefing",
  cardinality: "singleton",
  session: { stateSchema: channelSessionStateSchema },
  actions: { ...myActions, ...inventoryWriterActions("briefing") },
});
```

The string you pass is the value that appears as `kind` on that channel's rows. Passing the wrong one is that kind's bug.

A kind passed under `channelInstances`'s `kinds` option is yours to build. The `inventory: true` flag reaches the built-in only.

## What is and is not written

**What `openInventory` writes:**

- One row per seat at `inventory/seats/<seatId>`, carrying `{ id, kind }`.
- One row per channel at `inventory/channels/<channelId>`, carrying `{ id, kind, members, openedAt }`.
- One row per member per channel at `inventory/members/<seatId>/<channelId>`.

**What the channel's `members` contains:**

The seat ids its session holds, read by the channel itself. An edit to `members:` in a `CHANNEL.md` does not reach a channel that is already open, so it does not reach the row either. The inventory reports what the open channel holds, not what the file said when it was last read.

**Running it twice:**

Every write is an upsert keyed by the record's id. Running over the same roster writes the same rows. Nothing duplicates, and a channel that has been open since an earlier boot keeps its original `openedAt`.

**Nothing is deleted:**

A row stays where it is when a later roster no longer names the seat or the channel. There is no reconcile pass, no removal call.

## What stops a write

Both are wiring mistakes an app should fix at startup.

**No `orgId`:**

The inventory is org-scoped, so a write with no org lands where no flow can read it back. `openInventory` refuses and names what to pass.

**Seats with no `seatWriter`:**

A seat has no session of its own, so its row needs a flow to run in. `openInventory` refuses and names what to pass.

## What lands in `problems`

`openInventory` returns `{ seats, channels, problems }`. It collects failures rather than throwing, so one channel that cannot register is not an app with no inventory.

A channel shows up in `problems` when:

- Its session is not an open channel.
- Its kind declares no registration action.

A seat write failure shows up once, naming every seat that could not be written.

The rest of the roster is still attempted. Which of these is fatal is yours to decide.

## Listing one seat's channels

The membership index keys on the seat first, so a seat's channels are answerable by prefix.

```ts
import { membershipPrefix } from "@flow-state-dev/workforce";

const rows = await ctx.resources.memberships.list(membershipPrefix(seatId));
```

`membershipPrefix("engineering.lead")` is `"engineering.lead/"`. The trailing slash keeps `"engineering.lead"` from also matching `"engineering.leadership"`.

**What the prefix does not buy:**

Narrowing is not pushed into the store. The runtime fetches every membership row under the org before the prefix narrows it, so the cost grows with the org rather than with the seat.
