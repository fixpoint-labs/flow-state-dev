---
title: Persistence
type: concept
description: The store is the setting that decides what your app has after a restart. Memory keeps nothing, SQLite keeps it in a file, Postgres keeps it in a database.
---

import Figure from "@site/src/components/Figure";
import WhatARestartKeeps from "./figures/what-a-restart-keeps.svg";

# Persistence

Persistence is what your app has after the server restarts, and the store is the setting that decides it. The store holds what Flow State saves for you: sessions (one record per run of requests, such as a customer conversation), the state and resources attached to them, and runs that have stopped to wait for an answer.

The example is a support desk, a flow named `support`: a self-contained system inside your app that clients call by action name. Organizations such as `acme` have customers, and a customer such as Alice has a `plan`.

<Figure svg={WhatARestartKeeps} caption="What each store keeps across a restart" description={"Three boxes side by side, one per store: Memory, SQLite and Postgres. Each lists four things: sessions, state, resources and paused runs. SQLite and Postgres have hatched tops, meaning their data outlives the request, and keep everything: sessions, state and resources are kept, and a paused run is held. Memory has no hatching and loses everything on restart: sessions, state and resources are gone, and its paused runs row is highlighted because a paused run is never held in memory."} />

## The default: nothing to write

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import support from "./src/flows/support/flow";

export default createFlowState({ flows: [support] });
```

With no `stores` setting, the app runs in memory. Restart the server and every session, every piece of state and every resource is gone. On memory, a run that reaches a stop for a user's approval fails at that stop, and nothing is held.

That suits development, tests and demos. `fsdev dev` on a project with no `fsdev.config.ts` is different: it opens a SQLite file for you, so it keeps its data. The [stores reference](../reference/stores.md) covers the startup message and where the file is.

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

`sqliteStores` creates the file if it is missing. Sessions, state and resources are in it after a restart.

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

Several servers can share the database, and a change saved on one shows up for a client watching that session on another. The [stores reference](../reference/stores.md) covers the connection options.

## Choosing

Nothing to keep: memory. One machine, one file that survives restarts: SQLite. More than one server, or a production fleet: Postgres.

To use one store in development and another in production, give `stores` a named profile for each. Profiles, and a fourth store that keeps a folder of files for local development, are on the [stores reference](../reference/stores.md).

## Who owns a record

A session belongs to one user in one organization, fixed when it is created.

User state is keyed by the user and the organization together, so one person has one user record per organization. Alice, a customer of both `acme` and `globex`, has two. The `plan` she saves in `acme` is not there when she opens the support desk in `globex`. Bob, in `acme`, has a record of his own, so he does not see Alice's `plan` either. Org state is keyed by the organization alone, and every user in `acme` shares it. [Auth and tenancy](./auth-and-tenancy.md) covers where the user and organization come from.

## A run that is waiting

A run can stop for a user, to approve a refund, say. On SQLite or Postgres that stop is held until someone answers it, and a restart does not drop it: answer afterwards and the same request completes. [Pausing, resuming and surviving a crash](./pausing-resuming-and-surviving-a-crash.md) covers pauses and what happens when a server is killed mid-run.

## What it gets you

- **Data that outlives the process.** On SQLite or Postgres, `acme`'s sessions, Alice's `plan` and every resource are there after a restart.
- **Runs that wait for a user.** An approval can sit overnight and be answered after a deploy.
- **No filtering code.** A record is per user and per organization, so what Alice saves in `acme` is never read in `globex`, and no block writes `where org = ...`.
- **One line to change.** A flow never names a store, so moving `support` from SQLite to Postgres edits the `stores` line and nothing in the flow.

## How it fits with the others

[State and scopes](./state-and-scopes.md) decides which record a field goes in. The store decides where records live. A [resource](./resources.md) persists with its own scope, and a session's items live with the session ([Sessions, items and streaming](./sessions-items-and-streaming.md)).

## Next

- [Stores reference](../reference/stores.md) covers each store's options, profiles, running several servers on one database, what a custom store must guarantee and how to look up sessions by metadata.
- [Move data between stores](../build/move-data-between-stores.md) shows how to copy an existing app's data to a new store.
- [Auth and tenancy](./auth-and-tenancy.md) covers how organizations and tenants keep data apart.
