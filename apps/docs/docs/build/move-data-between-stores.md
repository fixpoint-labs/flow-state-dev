---
title: Move data between stores
type: recipe
description: "Copy an app's sessions, requests and resource data from one store to another, such as SQLite to Postgres, and check the copy before switching."
---

# Move data between stores

A store is where an app keeps its records: sessions, requests, and the state and content of resources. When you outgrow one, say a SQLite file on a laptop for Postgres in production, the records have to follow. There is no export command and no import command. Every store, whatever it is built on, answers the same set of read and write calls, so a short script can read from one store and write to another. This page is that script, for the `support` flow in the `acme` organization.

The old store is only read, never changed. Until you switch it holds the app's data, and pointing back at it is the rollback.

## 1. Decide what to move

The script copies:

- sessions, including child sessions, and their requests, items and stream events
- user records and organization records
- resource state and resource content, for each session, user and organization, and for the lineage scope (resources shared across a session and the sessions started under it)

It does not copy these, each described under [Moving data between stores](../reference/stores.md#moving-data-between-stores) in the stores reference:

- **Paused runs.** Answer or discard every stop before you start.
- **Attachment bytes.** Copy the folder the `blobs` slot uses, `.fsdev/blobs/<profile>` by default.
- **Traces, leases and dynamic schedules.** Recreate schedules on the new store.
- **In-memory data.** The in-memory store cannot be the source.
- **Resource history.** Past versions and deletions aren't copied. A deleted key reads on the new store as if it was never written. Each resource restarts at version 1, so a writer holding an older version gets a conflict on its next write. Session, user and organization records keep their versions. See [Resources and collections](../reference/resources.md#what-gets-stored).

Records written without a `flowId` or `orgId` arrive without them. Set both on those records before you switch, as [the stores reference](../reference/stores.md#moving-data-between-stores) describes.

Stop the app, or stop sending it traffic, before you start. The script reads a store that must not change under it.

## 2. Open both stores

Open both stores through their adapters. `resolve` returns the store's read and write calls, and `dispose` closes it. `copyScope` reads one scope's resource state and content and writes them across. Passing `"absent"` to a write stores the record only if the new store holds none at that id, so a rerun leaves those records alone. `content.set` takes no such argument and overwrites.

```ts title="src/lib/move-stores.ts"
import { toBareStates, type StoreAdapter, type StoreRegistry } from "@flow-state-dev/engine";
import { postgresStores } from "@flow-state-dev/store-postgres";
import { sqliteStores } from "@flow-state-dev/store-sqlite";

type ScopeType = "session" | "user" | "org" | "lineage";

async function open(adapter: StoreAdapter): Promise<StoreRegistry> {
  return (await adapter.resolve(["primary"])) as StoreRegistry;
}

async function copyScope(from: StoreRegistry, to: StoreRegistry, type: ScopeType, id: string) {
  const states = toBareStates(await from.resourceState.getAll(type, id));
  for (const [key, state] of Object.entries(states)) {
    await to.resourceState.set(type, id, key, state, "absent");
  }
  const content = await from.content.getAll(type, id);
  for (const [key, text] of Object.entries(content)) {
    await to.content.set(type, id, key, text);
  }
}
```

## 3. Copy the records

Walk the sessions, then the users and organizations. List sessions with `parentage: "all"`, or every child session is left behind. Each record keeps the `id` it came with. A session started for a tenant, one of several customers an app serves from a single deployment, has an id of the form `<tenantId>:<sessionId>`, and its requests are listed by the id without that prefix. `persistItems` and `persistEvents` queue their writes; the `flushItems` and `flushEvents` calls that follow wait for them to finish.

```ts title="src/lib/move-stores.ts"
export async function moveStores(sqliteFile: string, connectionString: string) {
  const oldAdapter = sqliteStores({ filename: sqliteFile });
  const newAdapter = postgresStores({ connectionString });
  const from = await open(oldAdapter);
  const to = await open(newAdapter);

  for (const session of await from.session.list({ parentage: "all" })) {
    await to.session.set(session.id, session, "absent");
    await copyScope(from, to, "session", session.id);
    if (session.lineageId) await copyScope(from, to, "lineage", session.lineageId);

    // Requests are listed by the session id without its tenant prefix.
    const bareId = session.tenantId ? session.id.slice(session.tenantId.length + 1) : session.id;
    const requests = await from.request.list({
      sessionId: bareId,
      tenantId: session.tenantId,
      withItems: true,
    });
    for (const request of requests) {
      const { items = [], ...record } = request;
      await to.request.set(request.id, record, "absent");
      to.request.persistItems(request.id, items);
      await to.request.flushItems(request.id);
      to.request.persistEvents(request.id, await from.request.getEvents(request.id));
      await to.request.flushEvents(request.id);
    }
  }

  // The id of each flow that sets flowIsolation: its user and org resources
  // are stored under the record's id plus `:<flowId>`.
  const isolatedFlowIds = ["support"];
  for (const user of await from.user.list()) {
    await to.user.set(user.id, user, "absent");
    await copyScope(from, to, "user", user.id);
    for (const flowId of isolatedFlowIds) await copyScope(from, to, "user", `${user.id}:${flowId}`);
  }
  for (const org of await from.org.list()) {
    await to.org.set(org.id, org, "absent");
    await copyScope(from, to, "org", org.id);
    for (const flowId of isolatedFlowIds) await copyScope(from, to, "org", `${org.id}:${flowId}`);
  }

  await oldAdapter.dispose?.();
  await newAdapter.dispose?.();
}
```

Run the script against an empty Postgres database. Running it twice is safe for records and overwrites resource content, as the [stores reference](../reference/stores.md#moving-data-between-stores) lists.

## 4. Check the counts

Compare the two stores before you trust the copy. Count each list on both sides: sessions with `parentage: "all"`, users, organizations, and each request's items with `countItems`. Then, for each scope you copied, compare the number of keys `resourceState.getAll` returns on both sides, and the number `content.getAll` returns.

For a whole-database cross-check, run the same query on both. SQLite and Postgres use the same table names.

```sql
SELECT COUNT(*) FROM sessions;
SELECT COUNT(*) FROM resource_content;
```

A count that differs names the part to look at. If the per-scope counts agree but the `resource_content` totals differ, some content sits under a scope id the script doesn't visit, most often a flow left out of `isolatedFlowIds`. Find that id and add a `copyScope` call for it. Resource state has no whole-database count, so check the isolated scopes by key as well.

Last, start a copy of the app against the new store and open one real `acme` session. Read its state and a resource through it.

## 5. Switch

Change the `stores` setting in `fsdev.config.ts` from the old adapter to the new one, and restart.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { postgresStores } from "@flow-state-dev/store-postgres";
import support from "./src/flows/support/flow";

export default createFlowState({
  flows: [support],
  stores: postgresStores({ connectionString: process.env.FSD_DB_URL }),
});
```

No flow changes. Keep the old store until the new one has served real traffic. After the new store takes writes it is the only correct copy, and the old one stops being a rollback.

For the options each store takes, see [the stores reference](../reference/stores.md). For which store to pick and what each keeps across a restart, see [Persistence](../concepts/persistence.md).
