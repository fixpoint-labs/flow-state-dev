---
title: Inventory
sidebar_position: 5
sidebar_label: Inventory
description: "A record of every seat and channel registered in an organization: one row per seat, one per channel, and one per seat-in-channel. A row says the thing was registered, not that it is open or working now."
---

# Inventory

The tree tells you what a workforce is meant to be. A `WORKER.md` declares a seat and a `CHANNEL.md` declares a channel, and both are read once at boot. Neither can tell a block which seats and channels were actually set up in an organization, or which channels a given seat belongs to. A block cannot walk folders to find out.

The inventory keeps that record as data: three org-scoped resource collections that a block reads the way it reads any other resource.

| Collection | One row per | Key |
|------------|-------------|-----|
| Seats | registered seat | `inventory/seats/<seatId>` |
| Channels | registered channel | `inventory/channels/<channelId>` |
| Memberships | seat-in-channel | `inventory/members/<seatId>/<channelId>` |

**A row means registered, not open.** It records that a seat or channel was registered in this organization. It says nothing about whether that seat is working or that channel is open now. Nothing deletes a row, so a fired seat keeps its row, and a seat or channel a later roster no longer names keeps its row too. Label rows that way wherever you show them.

## When to use which source

**Where the seat exists:** the tree (the `WORKER.md` folder).

**Where the channel is declared:** the tree (the `CHANNEL.md` folder).

**Which channels have registered in this org:** the inventory.

**Which seats a channel was registered with:** the inventory's channel row, which holds `members`.

**Which channels a seat is in:** the inventory's membership index.

The two layers join on one thing: the `id`.

**Who may post to a channel:** the channel itself, checking its own session state. The `post` and `fileTask` blocks read `members` from the channel's session, not from the inventory. To find out whether a seat's post will be accepted, ask the channel. The inventory's `members` is a copy for finding things, not the check.

For the seats hired at runtime and not yet fired, read the [hired roster](./durable-hire.md#the-roster) instead. A roster row goes away when the seat is fired; an inventory row stays.

## Wiring the boot

Rows are written by actions that run inside flows, not by a standalone call. So they are written at boot, after flows are registered and channels are open.

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

`openInventory` takes the organization as `orgId`. `openChannels` does not: each channel session takes its organization from the caller.

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
    source: request.source,
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  });
  if (result?.error !== undefined) {
    throw result.error instanceof Error ? result.error : new Error(String(result.error));
  }
  return result;
};
```

The door has to reject. One that hands back a failed run as an ordinary value reports every channel registered while writing nothing.

It has to forward `source` as well. The seat write is a boot-only action: its request carries `source: "internal"`, and it runs only when that value reaches `runAction`. A door that drops `source` makes the seat write fail, and `problems` names it.

### Where the seat rows go

Seat rows need a flow to run in, because a resource collection can only be written from inside a flow. Any flow carrying `inventoryWriterActions` will do. A channel kind built with `inventory: true` carries them, so `seatWriter: { flowKind: "channel" }` is the usual line. An app that has no channels, or whose channels run a kind of its own, names whichever flow carries the writer.

### What stops a write

Both of these are wiring mistakes an app should fix at startup.

**No `orgId`:** the inventory is org-scoped, so a write with no org lands where no flow can read it back. `openInventory` refuses and names what to pass.

**Seats with no `seatWriter`:** a seat has no session of its own, so its row needs a flow to run in. `openInventory` refuses and names what to pass.

### What lands in `problems`

`openInventory` returns `{ seats, channels, problems }`. It collects failures rather than throwing, so one channel that cannot register does not leave the app with no inventory.

A channel shows up in `problems` when:

- Its session is not an open channel.
- Its kind declares no registration action.

A seat write failure shows up once, naming every seat that could not be written.

The rest of the roster is still attempted. Which of these is fatal is yours to decide.

### Running it twice

Every write is an upsert keyed by the record's id. Running over the same roster writes the same rows. Nothing duplicates, and a channel registered on an earlier boot keeps its original `openedAt`.

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

`openedAt` is an ISO timestamp set the first time the channel registers and left alone after.

`members` is the seat ids the channel's session held when it registered, read by the channel itself, not the list the roster declares. An edit to `members:` in a `CHANNEL.md` does not reach a channel that is already open, so it does not reach the row either.

### Listing one seat's channels

The membership index keys on the seat first, so a seat's channels are answerable by prefix, as `seatChannels` above does with `membershipPrefix`.

`membershipPrefix("engineering.lead")` is `"engineering.lead/"`. The trailing slash keeps `"engineering.lead"` from also matching `"engineering.leadership"`.

The prefix does not make the read cheaper. The runtime fetches every membership row under the org before the prefix narrows it, so the cost grows with the org rather than with the seat.

### From a browser

All three collections can be read from a browser, with the same collection read your app's client code uses for any other resource. You read through a session, by the name that session's flow gave the collection in its `resources` map. That name is up to the flow, so look it up in the session's resource manifest by pattern:

```ts
import { createResourceClient } from "@flow-state-dev/client";

const resources = createResourceClient({ baseUrl: "https://app.example.com" });

const manifest = await resources.getResourceManifest(channelSessionId);
const channelsRef = manifest.resources.find(
  (entry) => entry.pattern === "inventory/channels/*",
)?.ref;

const channels: unknown[] = [];
if (channelsRef !== undefined) {
  let cursor: string | undefined;
  do {
    const page = await resources.listCollectionItems(channelSessionId, channelsRef, { cursor });
    channels.push(...page.items.map((item) => item.clientData));
    cursor = page.nextCursor;
  } while (cursor !== undefined);
}
// channels[0] → { id: "engineering.standup", kind: "channel", members: [...], openedAt: "..." }
```

The patterns are `inventory/seats/*`, `inventory/channels/*` and `inventory/members/**`. A channel built with `channelInstances(roster.channels, { inventory: true })` declares all three, so any channel's session can read the whole inventory. A seat whose kind carries the [`seat-hire` tools](./durable-hire.md) declares only the seat collection.

**Which organization:** the session's. The server takes it from the session, and the session took it from your principal resolver when it was created. Nothing in the request can name a different one.

**What each row carries:** the fields in [What each row holds](#what-each-row-holds), and no others.

**Paging:** pass `nextCursor` back as `cursor` until `nextCursor` is undefined. `limit` takes 1 to 200 and defaults to 50.

**When the ref is wrong:** the call rejects with a `ClientHttpError` whose `status` is 404.

The DevTool's [Inventory tab](../devtool/overview.md#inventory) makes the same read and shows the rows as tables.

## Writing from your own kind

A channel kind you wrote yourself gets rows when it carries the writer. `inventoryWriterActions(kind)` gives back its two blocks by action name. Split them across `actions` and `internal.actions`, the way the built-in kind does:

- `registerChannelInInventory` is safe to leave public. It takes no input and builds its row from the channel's own open session.
- `registerSeatsInInventory` is not. Its whole input is the row data, so it belongs only in `internal.actions`, where only the `runAction({ source: "internal", ... })` call `openInventory` makes can reach it.

```ts
import { defineFlow } from "@flow-state-dev/core";
import {
  channelSessionStateSchema,
  inventoryWriterActions,
} from "@flow-state-dev/workforce";

const writer = inventoryWriterActions("briefing");

const briefingKind = defineFlow({
  kind: "briefing",
  cardinality: "singleton",
  session: { stateSchema: channelSessionStateSchema },
  actions: {
    ...myActions,
    registerChannelInInventory: writer.registerChannelInInventory,
  },
  internal: {
    actions: { registerSeatsInInventory: writer.registerSeatsInInventory },
  },
});
```

The string you pass `inventoryWriterActions` is the value that appears as `kind` on that channel's rows. Pass the same string you gave `defineFlow({ kind })`.

A kind passed under `channelInstances`'s `kinds` option is yours to build. The `inventory: true` flag reaches the built-in only.

## Reaching the inventory from an agent

An agent does not read these rows directly. It calls [discovery](../orchestration/discovery.md), which turns the same rows into short entries it can plan against. Discovery reads the rows and writes none.
