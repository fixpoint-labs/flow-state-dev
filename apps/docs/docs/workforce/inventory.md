---
title: Inventory
sidebar_position: 5
sidebar_label: Inventory
description: "A record of every seat and mailbox registered in an organization: one row per seat, one per mailbox, and one per seat-in-mailbox. A row says the thing was registered, not that it is open or working now."
---

# Inventory

The tree tells you what a workforce is meant to be. A `WORKER.md` declares a seat and a `MAILBOX.md` declares a mailbox, and both are read once at boot. Neither can tell a block which seats and mailboxes were actually set up in an organization, or which mailboxes a given seat belongs to. A block cannot walk folders to find out.

The inventory keeps that record as data: three org-scoped resource collections that a block reads the way it reads any other resource.

| Collection | One row per | Key |
|------------|-------------|-----|
| Seats | registered seat | `inventory/seats/<id>`; for a seat hired at runtime, `<id>` is its address, such as `acme.support.ada` |
| Mailboxes | registered mailbox | `inventory/mailboxes/<mailboxId>` |
| Memberships | seat-in-mailbox | `inventory/members/<seatId>/<mailboxId>` |

**A row means registered, not open.** It records that a seat or mailbox was registered in this organization. It says nothing about whether that seat is working or that mailbox is open now. Nothing deletes a row for going missing, so a seat or mailbox a later roster no longer names keeps its row. Label rows that way wherever you show them.

There are two removals. Firing a seat hired at runtime removes its row, and only the row its own hire published (see below). And when a `MAILBOX.md` becomes a project talk template (`mintFor: projects`), it is no longer a mailbox, so the next `openInventory` removes its mailbox row and membership rows through the `seatWriter`. Discovery never lists a template as a mailbox, even before that boot runs.

## When to use which source

![Four records, each answering one question. Your files: what is declared? A WORKER.md or MAILBOX.md, read at every start; a seat hired at runtime has no file. Inventory, in the organization's store: was it registered here? A seat row (id, kind, door, hired, incarnation, where hired says the seat came from a runtime hire rather than a file), a mailbox row with a copy of its members, and a membership row per seat in a mailbox. A declared row is never deleted; firing a seat hired at runtime removes its row. Hired roster, a row at workforce/roster/ plus the seat id: is it hired right now? It holds only seats hired while the app runs, and a row is deleted when its seat is fired. The mailbox's session: will this post be accepted? Its state holds members and instructions, and post and fileTask check the author a post names against those members. The inventory's members is a copy for finding mailboxes, never the check. A seat hired at runtime has its address as its inventory id, such as acme.support.ada, while members name it support.ada.](./seat-mailbox-records.svg)

Each column answers one question, so ask the record that owns yours. Two are easy to mix up. Whether a seat hired at runtime is hired right now is the [hired roster](./durable-hire.md#the-roster)'s, not the inventory's. Whether a post's `author` is accepted depends on the `members` in the mailbox's session state, not the inventory's copy.

The inventory and your files join on the seat's `id`, except for a seat hired at runtime: its inventory `id` is its address, such as `acme.support.ada`, while a mailbox's `members` name it `support.ada`. For a team list, use `listedSeatRows` from `@flow-state-dev/workforce/browser`. It keeps every declared seat's row and a hired seat's row only while the hired roster backs it, so a seat that is no longer hired drops out.

## Wiring the boot

Rows are written by actions that run inside flows, not by a standalone call. So they are written at boot, after flows are registered and mailboxes are open.

```ts
import {
  mailboxInstances,
  hireWorkforce,
  openMailboxes,
  openInventory,
} from "@flow-state-dev/workforce";

const seats = hireWorkforce(roster.workers);
const instances = mailboxInstances(roster.mailboxes, { inventory: true });

flowRegistry.registerMany([...seats, ...instances]);
// server starts here

await openMailboxes(roster.mailboxes, {
  client: sessionClient,
  userId: "u_boot",
});

await openInventory(
  { seats, mailboxes: roster.mailboxes },
  {
    run,
    seatWriter: { flowKind: "mailbox" },
    userId: "u_boot",
    orgId: "org_acme",
  }
);
```

`openInventory` takes the organization as `orgId`. `openMailboxes` does not: each mailbox session takes its organization from the caller.

The writer needs both halves:

1. `mailboxInstances(roster.mailboxes, { inventory: true })` builds the built-in kind carrying the registration actions and the three collections.
2. `openInventory(...)` runs those actions: once per mailbox, once for all seats.

Leave both out and mailboxes work without an inventory. Nothing is declared, nothing is written, and the three collection factories return collections whose keys resolve empty.

### The `run` callback

`run` is the callback your app hands `openInventory` to run an action. It takes the action request `openInventory` builds, runs it through your runtime, and rejects when the action fails:

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

The `run` callback has to reject. One that hands back a failed run as an ordinary value reports every mailbox registered while writing nothing.

It has to forward `source` as well. The seat write is a boot-only action: its request carries `source: "internal"`, and it runs only when that value reaches `runAction`. A `run` callback that drops `source` makes the seat write fail, and `problems` names it.

### Where the seat rows go

Seat rows need a flow to run in, because a resource collection can only be written from inside a flow. Any flow carrying `inventoryWriterActions` will do. A mailbox kind built with `inventory: true` carries them, so `seatWriter: { flowKind: "mailbox" }` is the usual line. An app that has no mailboxes, or whose mailboxes run a kind of its own, names whichever flow carries the writer.

### What stops a write

Both of these are wiring mistakes an app should fix at startup.

**No `orgId`:** the inventory is org-scoped, so a write with no org lands where no flow can read it back. `openInventory` refuses and names what to pass.

**Seats with no `seatWriter`:** a seat has no session of its own, so its row needs a flow to run in. `openInventory` refuses and names what to pass.

### What lands in `problems`

`openInventory` returns `{ seats, mailboxes, problems }`. It collects failures rather than throwing, so one mailbox that cannot register does not leave the app with no inventory.

A mailbox shows up in `problems` when:

- Its session is not an open mailbox.
- Its kind declares no registration action.

A seat write failure shows up once, naming every seat that could not be written.

The rest of the roster is still attempted. Which of these is fatal is yours to decide.

### Running it twice

Every write is an upsert keyed by the record's id. Running over the same roster writes the same rows. Nothing duplicates, and a mailbox registered on an earlier boot keeps its original `openedAt`.

Seat rows have one exception. The roster a boot read can be older than the store, because during a rolling deploy another server may have fired a seat and hired it again, or dropped a declared seat and hired the same address. So a boot writes a seat's row only where there was no row when it read the inventory, or where the stored row is the same kind of seat: for a declared seat, a declared seat's row, and for a hired seat, a row carrying the same incarnation. A boot never writes over a runtime hire's row with another hire's or a declared seat's, and it doesn't bring back a row that a fire removed after the boot read it. A row it leaves isn't counted in `seats`, as long as your `run` returns the action's output or a result carrying it as `output`.

A hire that finds a declared seat's row at its address, written by such a boot while the hire was running, doesn't write over it either. The hire takes back the seat it registered and its roster row, and refuses.

## Reading the inventory

Declare the same collections on any block. They return the same rows, because a collection is addressed by its pattern and scope, never by object identity.

```ts
import {
  defineMailboxInventoryCollection,
  defineMembershipIndexCollection,
  defineSeatInventoryCollection,
  membershipPrefix,
} from "@flow-state-dev/workforce";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const seats = defineSeatInventoryCollection();
const mailboxes = defineMailboxInventoryCollection();
const memberships = defineMembershipIndexCollection();

const seatMailboxes = handler({
  name: "seat-mailboxes",
  inputSchema: z.object({ seatId: z.string() }),
  outputSchema: z.object({ mailboxIds: z.array(z.string()) }),
  resources: { memberships },
  execute: async (input, ctx) => {
    const rows = await ctx.resources.memberships.list(membershipPrefix(input.seatId));
    return { mailboxIds: rows.map((row) => row.state.mailboxId) };
  },
});
```

`list()` hands back resource refs. The row is on `ref.state`.

### What each row holds

**Seat:**

```ts
{ id: "engineering.lead", kind: "agent", door: "run", hired: false, incarnation: null }
```

`hired` says where the seat came from: `true` for a seat hired at runtime, whose id is its address, and `false` for one declared in a worker file. Read it rather than the id's shape, because a declared team can share the organization's name. A row written before the field existed has `hired: null` until the next boot rewrites it. `incarnation` names the hire or repair that published a hired seat's row. Fire removes a row only when it carries the incarnation being fired, so a seat hired again at the same address keeps its own row, and never removes a declared seat's row. A team list shows a hired seat's row only while the roster row at its address carries the same incarnation.

`door` names an action on the seat's flow: the one that takes a person's message for this seat. It is the kind's one public action that declares `userMessage` and takes `{ message }`. The built-in worker's is named `run`, which is unrelated to the `run` callback above. A kind with no such action gets `door: null`, and an app should say that seat takes no message rather than guess. A kind with two gets `null` too, and the hire warns, naming both: `hireWorkforce` logs it as a `[workforce]` console warning, and a seat hired at runtime returns it in the hire's `warnings`.

`openInventory` reads the door from each seat's `actions`, and `hired` from its settings, so pass it the seats `hireWorkforce` returned. A seat you build by hand needs `actions` too; pass `{}` for one that takes no message.

**Mailbox:**

```ts
{
  id: "engineering.standup",
  kind: "mailbox",
  members: ["engineering.lead", "engineering.analyst"],
  openedAt: "2026-09-19T09:14:07.123Z"
}
```

A project's talk session is never a mailbox row. The mailbox rows are the mailboxes you declared, and nothing else.

**Membership:**

```ts
{ seatId: "engineering.lead", mailboxId: "engineering.standup" }
```

`openedAt` is an ISO timestamp set the first time the mailbox registers and left alone after.

`members` is the seat ids the mailbox's session held when it registered, read by the mailbox itself, not the list the roster declares. An edit to `members:` in a `MAILBOX.md` does not reach a mailbox that is already open, so it does not reach the row either.

### Listing one seat's mailboxes

The membership index keys on the seat first, so a seat's mailboxes are answerable by prefix, as `seatMailboxes` above does with `membershipPrefix`.

`membershipPrefix("engineering.lead")` is `"engineering.lead/"`. The trailing slash keeps `"engineering.lead"` from also matching `"engineering.leadership"`.

The prefix does not make the read cheaper. The runtime fetches every membership row under the org before the prefix narrows it, so the cost grows with the org rather than with the seat.

### From a browser

All three collections can be read from a browser, with the same collection read your app's client code uses for any other resource. You read through a session, by the name that session's flow gave the collection in its `resources` map. That name is up to the flow, so look it up in the session's resource manifest by pattern:

```ts
import { createResourceClient } from "@flow-state-dev/client";

const resources = createResourceClient({ baseUrl: "https://app.example.com" });

const manifest = await resources.getResourceManifest(mailboxSessionId);
const mailboxesRef = manifest.resources.find(
  (entry) => entry.pattern === "inventory/mailboxes/*",
)?.ref;

const mailboxes: unknown[] = [];
if (mailboxesRef !== undefined) {
  let cursor: string | undefined;
  do {
    const page = await resources.listCollectionItems(mailboxSessionId, mailboxesRef, { cursor });
    mailboxes.push(...page.items.map((item) => item.clientData));
    cursor = page.nextCursor;
  } while (cursor !== undefined);
}
// mailboxes[0] → { id: "engineering.standup", kind: "mailbox", members: [...], openedAt: "..." }
```

The patterns are `inventory/seats/*`, `inventory/mailboxes/*` and `inventory/members/**`. A mailbox built with `mailboxInstances(roster.mailboxes, { inventory: true })` declares all three, so any mailbox's session can read the whole inventory. A seat whose kind carries the [`seat-hire` tools](./durable-hire.md) declares only the seat collection.

**Which organization:** the session's. The server takes it from the session, and the session took it from your principal resolver when it was created. Nothing in the request can name a different one.

**What each row carries:** the fields in [What each row holds](#what-each-row-holds), and no others.

**Paging:** pass `nextCursor` back as `cursor` until `nextCursor` is undefined. `limit` takes 1 to 200 and defaults to 50.

**When the ref is wrong:** the call rejects with a `ClientHttpError` whose `status` is 404.

The DevTool's [Inventory tab](../devtool/overview.md#inventory) makes the same read and shows the rows as tables.

## Writing from your own kind

A mailbox kind you wrote yourself gets rows when it carries the writer. `inventoryWriterActions(kind)` gives back its three blocks by action name. Split them across `actions` and `internal.actions`, the way the built-in kind does:

- `registerMailboxInInventory` is safe to leave public. It takes no input and builds its row from the mailbox's own open session.
- `registerSeatsInInventory` is not. Its whole input is the row data, so it belongs only in `internal.actions`, where only the `runAction({ source: "internal", ... })` call `openInventory` makes can reach it.
- `retireMailboxesInInventory` belongs there too. Its input is the ids of mailbox rows to remove.

```ts
import { defineFlow } from "@flow-state-dev/core";
import {
  mailboxSessionStateSchema,
  inventoryWriterActions,
} from "@flow-state-dev/workforce";

const writer = inventoryWriterActions("briefing");

const briefingKind = defineFlow({
  kind: "briefing",
  cardinality: "singleton",
  session: { stateSchema: mailboxSessionStateSchema },
  actions: {
    ...myActions,
    registerMailboxInInventory: writer.registerMailboxInInventory,
  },
  internal: {
    actions: {
      registerSeatsInInventory: writer.registerSeatsInInventory,
      retireMailboxesInInventory: writer.retireMailboxesInInventory,
    },
  },
});
```

The string you pass `inventoryWriterActions` is the value that appears as `kind` on that mailbox's rows. Pass the same string you gave `defineFlow({ kind })`.

A kind passed under `mailboxInstances`'s `kinds` option is yours to build. The `inventory: true` flag reaches the built-in only.

## Reaching the inventory from an agent

An agent does not read these rows directly. It calls [discovery](../orchestration/discovery.md), which turns the same rows into short entries it can plan against. Discovery reads the rows and writes none.
