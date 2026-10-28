---
title: Inventory
sidebar_position: 10
sidebar_label: Inventory
description: "A record of every worker registered in an organization, one row per worker. A row says the worker was registered, not that it is working now."
---

# Inventory

The tree tells you what a workforce is meant to be. A `WORKER.md` declares a worker, and it is read once at boot. It can't tell a block which workers were actually set up in an organization, and a block can't walk folders to find out.

The inventory keeps that record as data: one org-scoped resource collection that a block reads the way it reads any other resource.

| Collection | One row per | Key |
|------------|-------------|-----|
| Workers | registered worker | `inventory/workers/<id>` |

**A row means registered, not working.** It records that a worker was registered in this organization. It says nothing about whether that worker is running now. Nothing deletes a row for going missing, so a worker a later roster no longer names keeps its row. Label rows that way wherever you show them.

The rows are the workers your files declare, the standard workers every user has. A user's own workers, hired or forked while the app runs, aren't listed: they are on that user's [roster](./durable-hire.md), which nobody else reads.

## When to use which source

| Question | Ask |
|----------|-----|
| What is declared? | Your files: each `WORKER.md`, read at every start. A user's own worker has no file. |
| Was it registered in this organization? | The inventory. A declared worker's row is never deleted, and a user's own worker has no row. |
| Whose worker is it? | That user's roster. Its row is deleted when the worker is fired. |

The inventory and your files join on the worker's `id`.

A [coordinator](./coordinators.md), a worker that hands work to other workers called its delegates, keeps its own delegate list. The inventory doesn't record it: ask the coordinator with `listDelegates`.

## Wiring the boot

Rows are written by an action that runs inside a flow, not by a standalone call. So they are written at boot, after flows are registered. The action comes from `inventoryWriterActions()`; put it on a small flow of your own, in `internal.actions`:

```ts
import { defineFlow } from "@flow-state-dev/core";
import {
  createWorkerInstallation,
  hireWorkforce,
  inventoryWorkers,
  inventoryWriterActions,
  openInventory,
} from "@flow-state-dev/workforce";

const installation = createWorkerInstallation({ standardWorkers: roster.workers });
const flows = hireWorkforce(installation);

const inventoryWriter = defineFlow({
  kind: "inventory-writer",
  actions: {},
  internal: { actions: { ...inventoryWriterActions() } },
})();

flowRegistry.registerMany([...flows, inventoryWriter]);
// server starts here

const { workers, problems } = await openInventory(
  { workers: inventoryWorkers(installation) },
  {
    run,
    workerWriter: { flowKind: "inventory-writer" },
    userId: "u_boot",
    orgId: "org_acme",
  }
);
```

`openInventory` takes the organization as `orgId`. An app with no authentication passes `DEFAULT_ORG_ID` from `@flow-state-dev/core`.

The write runs in a session named `inventory-binder` on the writer's flow, created on the first boot and reused after. Pass `workerWriter: { flowKind, sessionId }` to use another.

### The `run` callback

`run` is the callback your app hands `openInventory` to run an action. It takes the action request `openInventory` builds, runs it through your runtime, and rejects when the action fails:

```ts
const run = async (request) => {
  const result = await runAction({
    flow: byFlow[request.flowKind],
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

The `run` callback has to reject. One that hands back a failed run as an ordinary value reports the rows written while writing nothing.

It has to forward `source` as well. The write is a boot-only action: its request carries `source: "internal"`, and it runs only when that value reaches `runAction`. A `run` callback that drops `source` makes the write fail, and `problems` names it.

### Where the rows are written

A resource collection can only be written from inside a flow, and a worker has no session of its own for its row to be written in. So the rows need a flow to run in, and `workerWriter` names it. Any flow that spreads `inventoryWriterActions()` into its `internal.actions` will do.

Keep the writer in `internal.actions`, never `actions`. Its whole input is the row data, so a public caller could write rows for workers that don't exist. In `internal.actions`, only the `runAction({ source: "internal", ... })` call `openInventory` makes can reach it.

### What stops a write

Both of these are wiring mistakes an app should fix at startup. `openInventory` throws, and the message names what to pass.

**No `orgId`:** the inventory is org-scoped, so a write with no org lands where no flow can read it back.

**Workers with no `workerWriter`:** there is no flow to write their rows from. A roster with no workers needs none.

### What lands in `problems`

`openInventory` returns `{ workers, problems }`. `workers` is how many rows were written. It collects failures in `problems` rather than throwing: a write that fails shows up once, naming every worker whose row could not be written. Whether that is fatal is yours to decide.

### Running it twice

Every write is an upsert keyed by the worker's id. Running over the same roster writes the same rows, and nothing duplicates.

## Reading the inventory

Declare the same collection on any block. It returns the same rows, because a collection is addressed by its pattern and scope, never by object identity.

```ts
import { handler } from "@flow-state-dev/core";
import { defineWorkerInventoryCollection } from "@flow-state-dev/workforce";
import { z } from "zod";

const workers = defineWorkerInventoryCollection();

const registeredWorkers = handler({
  name: "registered-workers",
  inputSchema: z.object({}),
  outputSchema: z.object({ ids: z.array(z.string()) }),
  resources: { workers },
  execute: async (_input, ctx) => {
    const rows = await ctx.resources.workers.list();
    return { ids: rows.map((row) => row.state.id) };
  },
});
```

`list()` hands back resource refs. The row is on `ref.state`.

### What each row holds

```ts
{ id: "engineering.lead", kind: "agent", door: "respond", rules: true, hired: false, incarnation: null }
```

`kind` is the flow the worker runs on. Every row `openInventory` writes has `hired: false` and `incarnation: null`, because the inventory lists only the workers your files declare.

`door` names an action on the worker's flow: the one that takes a user's message for this worker. It is `respond`, the public action that declares `userMessage` and takes `{ message }`, on every worker flow: `hireWorkforce` refuses a flow without one, or with a second, before it registers anything ([which flows can run workers](./workers-on-disk.md#which-flows-can-run-workers)). A worker you build by hand with no such action gets `door: null`, and an app should say that worker takes no message rather than guess.

`rules` says whether the worker keeps [standing rules](./standing-rules.md): its flow declares the `standingRules` action. Check it before offering a rules screen for a worker. An app's own `agent` flow that leaves the action out gets `rules: false`.

`openInventory` reads the door and `rules` from each worker's `actions`, so pass it `inventoryWorkers(installation)`, which gives each standard worker with its flow's actions. A worker you build by hand needs `actions` too; pass `{}` for one that takes no message.

### From a browser

The collection can be read from a browser, with the same collection read your app's client code uses for any other resource. You read through a session, by the name that session's flow gave the collection in its `resources` map. That name is up to the flow, so look it up in the session's resource manifest by its pattern, `inventory/workers/*`:

```ts
import { createClient } from "@flow-state-dev/client";

const fsd = createClient({ userId, baseUrl: "https://app.example.com" });

const manifest = await fsd.resources.getResourceManifest(rosterSessionId);
const workersRef = manifest.resources.find(
  (entry) => entry.pattern === "inventory/workers/*",
)?.ref;

const workers: unknown[] = [];
if (workersRef !== undefined) {
  let cursor: string | undefined;
  do {
    const page = await fsd.resources.listCollectionItems(rosterSessionId, workersRef, { cursor });
    workers.push(...page.items.map((item) => item.clientData));
    cursor = page.nextCursor;
  } while (cursor !== undefined);
}
// workers[0] → { id: "engineering.lead", kind: "agent", door: "respond", rules: true, hired: false, incarnation: null }
```

Workforce's roster flow (`workforce-roster`) declares the collection, so every user's roster session reads the workers. So does any flow carrying `inventoryWriterActions()`.

**Which organization:** the session's. The server takes it from the session, and the session took it from your principal resolver when it was created. Nothing in the request can name a different one.

**What each row carries:** the fields in [What each row holds](#what-each-row-holds), and no others.

**Paging:** pass `nextCursor` back as `cursor` until `nextCursor` is undefined. `limit` takes 1 to 200 and defaults to 50.

**When the ref is wrong:** the call rejects with a `ClientHttpError` whose `status` is 404.

The DevTool's [Inventory tab](../devtool/overview.md#inventory) makes the same read and shows the rows as a table.

## Reaching the inventory from an agent

An agent does not read these rows directly. It calls [discovery](../orchestration/discovery.md), which turns the same rows into short entries it can plan against. Discovery reads the rows and writes none.
