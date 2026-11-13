---
title: Persistence
type: concept
description: The store is the setting that decides what your app has after a restart. Memory keeps nothing, SQLite keeps it in a file, Postgres keeps it in a database.
---

import Figure from "@site/src/components/Figure";
import WhatARestartKeeps from "./figures/what-a-restart-keeps.svg";

# Persistence

Persistence is what your app has after the server restarts, and the store is the setting that decides it. The store holds what Flow State saves for you: sessions (one record per run of requests, such as a customer conversation), the state and resources attached to them, and runs that have stopped to wait for a person.

The example is a support desk, a flow named `support`: a self-contained system inside your app that clients call by action name. Customers have a `plan`, and organizations such as `acme` have customers.

<Figure svg={WhatARestartKeeps} caption="What each store keeps across a restart" description={"Three boxes side by side, one per store: Memory, SQLite and Postgres. Each lists four things: sessions, state, resources and paused runs. SQLite and Postgres have hatched tops, meaning their data outlives the request, and keep everything: sessions, state and resources are kept, and a paused run is held. Memory has no hatching and loses everything on restart: sessions, state and resources are gone, and its paused runs row is highlighted because a paused run is never held in memory."} />

## The default: nothing to write

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import support from "./src/flows/support/flow";

export default createFlowState({ flows: [support] });
```

With no `stores` setting, the app runs in memory. Startup says so, and a production app that never set `stores` warns once. Restart the server and every session, every piece of state and every resource is gone. A run that stops for a person's approval is not held at all, since the hold would not outlive the process.

That suits development, tests and demos. One exception: `fsdev dev` on a project with no `fsdev.config.ts` opens a SQLite file at `.fsdev/data/fsdev.db` for you, so it keeps its data.

## SQLite: one machine, one file

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import support from "./src/flows/support/flow";

export default createFlowState({
  flows: [support],
  stores: sqliteStores({ filename: "./data/support.db" }),
});
```

`sqliteStores` creates the file if it is missing. Sessions, state and resources are in it after a restart, and a server can write to it while other processes read.

## Postgres: more than one server

```bash
pnpm add @flow-state-dev/store-postgres pg
```

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { postgresStores } from "@flow-state-dev/store-postgres";
import support from "./src/flows/support/flow";

export default createFlowState({
  flows: [support],
  stores: postgresStores({ connectionString: process.env.FSD_DB_URL }),
});
```

Leave `connectionString` out and the store reads `FSD_DB_URL`, then `DATABASE_URL`. With neither, it throws and asks for one. Several servers can share the database, and a change one of them saves reaches a session view open on another.

## Choosing

Nothing to keep: memory. One machine, one file that survives restarts: SQLite. More than one server, or a production fleet: Postgres.

To use one store in development and another in production, give `stores` a named profile for each. The app uses the profile named by the `FSD_ENV` environment variable, or `defaultProfile`. A fourth store, a folder of files for local development, is on the [stores reference](../reference/stores.md).

Changing the store does not change your flows. A flow never names a store; `stores` on `createFlowState` is the one place. Moving `support` from SQLite to Postgres edits that line and no block or action. What changes is what survives a restart.

## Who owns a record

A session belongs to one user in one organization, fixed when it is created, and records the flow that made it.

User state is keyed by the user and the organization together. Alice in `acme` and Alice in `globex` have two user records, so the `plan` she saves in one is not there in the other. Org state is keyed by the organization alone, and every user in `acme` shares it. An app with no sign-in runs in one default organization. [Auth and tenancy](./auth-and-tenancy.md) covers where the user and organization come from.

## A run that is waiting

A run can stop for a person, to approve a refund, say. On SQLite or Postgres that stop is held until someone answers it, and a restart does not drop it: answer afterwards and the same request completes. On SQLite, a turn that was running when the server was killed comes back as an interrupted turn. **Continue** carries the same request on, and **Discard** ends it. [Pausing, resuming and surviving a crash](./pausing-resuming-and-surviving-a-crash.md) covers both.

## What it gets you

- **Data that outlives the process.** On SQLite or Postgres, `acme`'s sessions, Alice's `plan` and every resource are there after a restart.
- **Runs that wait for a person.** An approval can sit overnight and be answered after a deploy.
- **No filtering code.** A user in two organizations has two records, so no block writes `where org = ...`.
- **One line to change.** The same flows run on another store by editing `stores`.

## How it fits with the others

[State and scopes](./state-and-scopes.md) decides which record a field goes in. The store decides where records live. A [resource](./resources.md) persists with its own scope, and a session's items live with the session ([Sessions, items and streaming](./sessions-items-and-streaming.md)).

## Next

- [Stores reference](../reference/stores.md) covers what a custom store must guarantee and how to look up sessions by metadata.
- [Move data between stores](../build/move-data-between-stores.md) shows how to copy an existing app's data to a new store.
- [Auth and tenancy](./auth-and-tenancy.md) covers how organizations and tenants keep data apart.
