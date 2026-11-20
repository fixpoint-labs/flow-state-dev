---
title: Stores
type: reference
description: "What each store persists, who owns a record and what keys it, what a custom store must guarantee, session lookup, cost per request and the change bus."
---

# Stores

A store is where Flow State keeps what has to outlive a function call: sessions, requests and their items, user and org state, resource state and content, and what a paused or crashed run needs to continue. An app names its store once and every flow in it uses that store, so changing where data lives changes no flow code.

The shape is an adapter. An adapter fills the slots the framework reads and writes through (`session`, `request`, `user`, `org` and the rest of the registry), so a store can be a folder of files, a SQLite file or a Postgres database, or one you write. In-memory (the default), filesystem, SQLite and Postgres ship, plus a Vercel Postgres variant. This page lists what each keeps, how records are owned and keyed, what a custom store has to do, and what each operation costs. [Persistence](../concepts/persistence.md) explains the model.

The examples use one app: a support desk whose `support-desk` flow runs for users in the organizations `acme` and `globex`.

## Quick answers

| Question | Answer |
| --- | --- |
| What must a custom store do atomically? | Every conditional write: scope `set` with `expectedVersion`, the delta verbs, `setFieldsIfStatus`, `deleteIfStatus`, resource-state `set` and `delete`, lease `acquire`, wake `owe`, `move` and `clear`, and resource index `completeBuild`. See [Atomicity](#what-must-be-atomic). |
| Which records carry an organization? | Session, request, active-request entry and wake carry `orgId`. User records and user- and org-scoped resources carry it in their key. Suspensions, checkpoints, leases, runOnce results, items, events and traces carry none and are reached through the request. See [Which records carry an organization](#which-records-carry-an-organization). |
| What persists if I set no `stores`? | Nothing. The app runs in memory and loses every session and request on restart. See [The default store](#the-default-store). |
| Can a client look sessions up by `metadata`? | Not on the server. Declare the key as a `.readonly()` state field and filter on `state`. See [Session lookup by metadata](#session-lookup-by-metadata). |
| Can two processes share one store? | Postgres, yes. SQLite, one writer at a time. The filesystem and in-memory stores, no. See [Concurrency and sharing](#concurrency-and-sharing). |

## Declaring stores

Pass `stores` to `createFlowState`. It takes one adapter, which becomes the `primary` slot of the `default` profile, or a map of named profiles.

```ts title="src/flow-state.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { postgresStores } from "@flow-state-dev/store-postgres";
import { supportDesk } from "./flows/support-desk/flow";

export const flowState = createFlowState({
  flows: [supportDesk],
  stores: {
    development: { primary: sqliteStores({ filename: ".fsdev/support-desk.sqlite" }) },
    production: { primary: postgresStores({ connectionString: process.env.DATABASE_URL }) },
  },
  defaultProfile: "development",
});
```

`supportDesk` is a registered flow, defined in its own file. How the profile in use is chosen is in [Runtime configuration](./runtime.md).

| Slot | Backs | If the profile leaves it out |
| --- | --- | --- |
| `primary` (required) | Sessions, requests, users, orgs, active requests, checkpoints, content, resource state, traces, suspensions, leases, wakes | Not allowed |
| `bus` | The [change bus](#the-change-bus) | The primary backs it if it declares `bus` (Postgres does). Otherwise an in-memory bus, for one process |
| `blobs` | Attachment bytes | The primary backs it if it declares `blobs` (the filesystem store: `<rootDir>/blobs`). Otherwise `.fsdev/blobs/<profile>/` under the working directory when the stores persist, and memory when they do not |

There are no other slots. A registry that leaves a member out gets the in-memory one for it.

| Adapter | Import | Declares |
| --- | --- | --- |
| `inMemoryStores(options?)` | `@flow-state-dev/engine` | `primary` |
| `filesystemStores({ rootDir, ... })` | `@flow-state-dev/engine` | `primary`, `blobs` |
| `sqliteStores({ filename, ... })` | `@flow-state-dev/store-sqlite` | `primary` |
| `postgresStores({ connectionString?, ... })` | `@flow-state-dev/store-postgres` | `primary`, `bus` |
| `vercelPostgresStores({ connectionString? })` | `@flow-state-dev/vercel/store` | `primary`, `bus` |

Code that builds a registry directly imports from the `/host` subpaths. They and the conformance suites on `@flow-state-dev/engine/testing` are listed in [Engine API](./api/engine.md).

### The default store

| With | The app |
| --- | --- |
| No `stores` | Runs on `inMemoryStores()`. Nothing persists across a restart. Stderr gets one line per process per profile: ``[flowstate] active profile: "<name>" (no `stores` set: the app runs in memory, and nothing persists across a restart)``. With `stores` set, the same line has no parenthesis |
| No `stores` and `NODE_ENV=production` | Also logs one warning per process: "createFlowState has no `stores`, so this production app runs in memory and loses its sessions and requests on every restart. Set `stores` to a persistent adapter, such as `stores: postgresStores({ connectionString })`." Not given when `stores` was set to the in-memory adapter on purpose |

Whether the stores persist decides the default for durable execution (pausing and continuing a run). The `durable` option is in [Pause, resume and replay](./durable-execution.md).

## What each store persists

| | In-memory | Filesystem | SQLite | Postgres |
| --- | --- | --- | --- | --- |
| Survives a restart | No | Yes | Yes | Yes |
| Sessions, requests, items, events, runOnce results | Process memory | JSON files, NDJSON for events | Tables | Tables (JSONB) |
| User and org records | Memory | Files | Tables | Tables |
| Resource state and content | Memory | Files in a browsable tree | Tables | Tables |
| Resource index | None, lookups scan | None, lookups scan | Tables | Tables |
| Checkpoints, suspensions, leases, wakes | Memory | Files | Tables | Tables |
| Active-request registry | Memory | `active-requests.json` | Table | Table |
| Traces | Memory | `traces/` NDJSON | Tables | Memory |
| Attachment bytes | Memory | `<rootDir>/blobs` | `.fsdev/blobs/<profile>/` | `.fsdev/blobs/<profile>/` |
| Backs `bus` | No | No | No | Yes |
| Registry shared across processes | No | No | No | Yes for `connectionString` and `{ pool }`; no for `{ executor }` |

### What each stored part is

For each part: who owns it, who can see it, where it is stored, and how many exist.

| Stored part | Owner | Who can see it | Where | How many |
| --- | --- | --- | --- | --- |
| Session record (state, title, description, tags, metadata, journal) | One user, one organization, one tenant when the caller sent one, one flow instance. `userId`, `orgId` and `flowId` are stamped at creation | The owner, through the session routes. A client sees `state` fields the flow `expose`s or declares `.readonly()`, plus `title`, `description`, `tags` and `metadata`; never `journal` or `resources` | `stores.session`; table `sessions` | One per session id per tenant |
| Request record | The same four owners as its session, stamped when the request starts | Its owner. Another user's, tenant's or (when the record carries one) organization's request answers `404`, as a missing one does | `stores.request`; table `requests` | One per request, many per session |
| Request items | The request | The owner, through the request and session routes, filtered per item visibility. Transient items are never stored | SQLite and Postgres: `request_items`, one row per item. Filesystem and in-memory: inline on the request record | One per item id per request |
| Request stream events | The request | The owner, through the request stream route | `request_events`; filesystem `<id>.events.json` (NDJSON) | One per event |
| runOnce results | The request | No route reads them | `request_runonce`; filesystem `<id>@<key>.runonce` | One per distinct key per request |
| User record (`ctx.user.state`) | One user in one organization, per flow when the flow isolates user state | The user's own flows; a client sees only `expose`d fields | `stores.user`; table `users` | One per (user, org), or per (user, org, flow) when isolated |
| Org record (`ctx.org.state`) | One organization, per flow when the flow isolates org state | Flows run in that org | `stores.org`; table `orgs`; filesystem directory `projects/` | One per org, or per (org, flow) when isolated |
| Resource state | The scope instance the resource is declared at: a session, a (user, org) cell, an org. A `sharedToLineage` session resource stores under the lineage | See [Resources and collections](./resources.md) | `stores.resourceState`; table `resource_state` | One per resource key per scope instance |
| Resource content | Same as its state | Same as its state | `stores.content`; table `resource_content` | One per resource key, or none until written |
| Resource index entries | The scope instance | Nobody; lookups read them | `resource_index`, `resource_index_built` (SQLite and Postgres) | One row per (row, index, value) |
| Sequencer checkpoint | The request | No public route | `stores.checkpoints`; `sequencer_checkpoints` | One per (request, sequencer instance), overwritten; deleted when the sequencer ends |
| Suspension record | The request's user and flow instance | The request's owner, who is listed their pending stops. Debug endpoints list them when `debugEndpointsEnabled` is on | `stores.suspensions`; `suspension_records` | One per `ctx.suspend()` call, kept until pruned |
| Resume lease | The request | Nobody | `stores.leases`; `leases` | At most one active per request |
| Wake (a stored note that a session owes work by a time) | The session's owner: flow kind, user, org, tenant | Nobody | `stores.wakes` (optional); `wakes` | One per (tenant, session, entry) |
| Active-request entry | The request | Nobody directly; it drives `interrupted` marking and cross-process abort | `stores.activeRequests`; `active_requests` | One per in-flight request, removed at the end |
| Trace events | The request | The DevTool and debug reads | `stores.traces`; see [Trace store](#trace-store) | Bounded |
| Attachment bytes | The session, deleted with it | The session's owner, through the upload and read routes | The `blobs` slot | One per upload |

Schedule-index rows are in [Schedules](./schedules.md) and the MCP credential is in [MCP server](./mcp-server.md).

A session's suspension record, with its fields and statuses, is in [Pause, resume and replay](./durable-execution.md).

### The filesystem store

| Fact | Detail |
| --- | --- |
| Option | `rootDir`, required, no default. Created on first write |
| Layout | Under `rootDir`: `sessions/`, `requests/`, `users/`, `projects/` (the org records), `content/`, `state/`, `checkpoints/`, `traces/`, `suspensions/`, `leases/`, `wakes/`, `blobs/`, `active-requests.json` |
| Resource files | The key `notes/meeting` is `content/<scope>/<scope id>/notes/meeting.md` and `state/<scope>/<scope id>/notes/meeting.json`, where `<scope>` is `session`, `user`, `org` or `lineage`. Segments are percent-encoded and every `.` in a segment is escaped, so the only `.` is the extension |
| State file | One file per resource: a JSON array `["fsdev.resource-state/1", version, lifecycle, state]`, committed in one rename |
| Request files | `requests/<id>.json` holds the record with its items inline. `<id>.events.json` is append-only NDJSON. `<id>.abort` is the cancel marker. `<id>@<key>.runonce` is one file per runOnce key |
| Writes | Crash-safe: a temp file, then a rename |
| Locks | Per record and per key, held in memory on the store instance. Two store instances over one directory, in one process or two, are not coordinated |
| Warning | Warns once per process, in any environment, unless `developmentOnly: true`. The flag changes no behaviour. Write cost grows with the number of items; see [Cost per request](#cost-per-request) |
| `onPersistError` | Called when a background write (requests, traces, the active-request registry) fails, before the failure is logged |
| Deleting a session | Content, state and blobs first, then the session record |

### The SQLite store

| Fact | Detail |
| --- | --- |
| Package | `@flow-state-dev/store-sqlite`. Depends on `better-sqlite3` `^11.0.0`, a native module. Node 22 or later |
| Options | `filename` (a path, or `":memory:"`), `skipSchemaInit` (default `false`), `traceStore: { maxRequests }`, `requestStore` (live-tail options) |
| The file | Created when missing. Its folder is not: a path in a folder that does not exist throws "Cannot open database because the directory does not exist" |
| On every open | `journal_mode = WAL`, `busy_timeout = 5000`, `synchronous = NORMAL`, `cache_size = -20000`, `foreign_keys = ON`, `temp_store = MEMORY` |
| Writers | One at a time. A second writer, in the same process or another, waits up to 5000 ms for the lock and then fails with `SQLITE_BUSY`. Readers are not blocked by a writer |
| Schema | Created on open: `sessions`, `requests`, `users`, `orgs`, `active_requests`, `request_items`, `request_events`, `request_runonce`, `resource_content`, `resource_state`, `resource_index`, `resource_index_built`, `sequencer_checkpoints`, `trace_request_roster`, `trace_events`, `schedule_index`, `suspension_records`, `leases`, `wakes` |
| `skipSchemaInit` | Skips the DDL. The database must already have every table, the resource-index tables included. The PRAGMAs are applied either way |
| `close()` | `createSQLiteStores` returns a registry with `close()`. The adapter calls it on dispose |
| `sharedAcrossProcesses` | Always `false`. Treat a SQLite file as local to one host, even on a shared volume |
| Change bus | Does not back `bus`, so each process gets its own in-memory bus, which says it crosses processes. An open session view then does no timed read, and another process's write to the file is not pushed to it. See [The change bus](#the-change-bus) |

### The Postgres store

| Fact | Detail |
| --- | --- |
| Package | `@flow-state-dev/store-postgres`, on `pg ^8.13.0` |
| Connection | `connectionString`, then `FSD_DB_URL`, then `DATABASE_URL`. With none of these and no `poolOptions` host, it throws "no connection string provided". Other shapes: `{ pool }` (your `pg.Pool`) and `{ executor }` (a `QueryExecutor` such as PGlite; process-local) |
| Pool options | `max` (10), `connectionTimeoutMillis` (10000), `idleTimeoutMillis` (30000), `poolOptions` (merged over those, the caller wins), `createPool` |
| Schema | Created on every `createPostgresStores` call, idempotent, under an advisory lock. On a connection string it tries the lock 20 times, 500 ms apart, and if it never gets it logs "could not acquire schema advisory lock; skipping init" and goes on. `skipSchemaInit: true` runs none, for a migration run out of band |
| Tail pool | `liveTailPool` omitted: a connection-string store makes its own pool (`max` from `LIVE_TAIL_POOL_MAX`, default 10) for `LISTEN`. `{ pool }` and `{ executor }` get none unless you pass one. `null` turns `LISTEN` off |
| Tables | The SQLite names without the `trace_*` tables, since traces stay in memory. Payloads are JSONB |
| Item ids | An item id over 2600 characters is refused. SQLite has the same limit |
| `close()` | Hands back the bus's listening connection, then ends the pools |

`vercelPostgresStores()` connects through `connectionString`, then `FSD_DB_URL`, then `DATABASE_URL`. Its options and defaults are in [Vercel API](./api/vercel.md).

## Who owns a record and what keys it

| Record | Primary key | Owner fields on the record |
| --- | --- | --- |
| Session | `<sessionId>`, or `<tenantId>:<sessionId>` with a tenant. Nothing else is in the key. | `flowKind`, `flowId`, `userId`, `orgId`, `tenantId`. |
| Request | The request id. | `flowKind`, `flowId`, `userId`, `sessionId`, `orgId`, `tenantId`. |
| User record | `<user>:~org:<org>`, or `<user>:~org:<org>:<flow id>` when the flow sets `isolateUserState` | `userId` |
| Org record | `<org>`, or `<org>:<flow id>` when the flow sets `isolateOrgState` | `orgId`, optional `userId` |
| Resource state and content | `(scope, scope id, resource key)`, with the scope id taken from the owning session, user, org or lineage. The key forms are in [Resources and collections](./resources.md) | none |
| Checkpoint | `(requestId, blockInstanceId)` | the request |
| Suspension | `(requestId, suspensionId)` | `userId`, `flowId`, `sessionId` |
| Lease | `requestId` | none |
| Wake | `(tenantId, sessionId, entry)` | `flowKind`, `userId`, `orgId` |
| Active request | `requestId` | `flowKind`, `flowId`, `userId`, `sessionId`, `orgId`, `tenantId` |

- **Key escaping.** In user and org keys, `\` and `:` inside an id are backslash-escaped. An id with neither keys as itself. Two different (user, flow) pairs never produce one key.
- **A user in two organizations has two records.** Alice in `acme` and Alice in `globex` read and write different user records and different user-scoped resources.
- **A missing organization throws.** Building a user key with a missing, blank or malformed org throws `OrgRequiredError`. A valid org id is a non-empty, non-whitespace string with no lone surrogate.
- **The session id is the whole key.** Only the session id, behind the tenant prefix, keys a session. The user, organization and flow are fields on the record, not part of the key. Within one tenant the first create at an id gets `201` and every later one gets `409` (`Session "<id>" already exists`), whoever sends it. If Alice and Bob in `acme` both create `ticket-42`, Bob's create gets `409`. Reading `ticket-42` as Bob then returns Alice's record in an app with no authentication. With authentication on it answers `404` (`Unknown session "ticket-42"`), as an unused id does. Build the id from everything that tells two sessions apart: user, organization, flow and ticket, as in [Session lookup by metadata](#session-lookup-by-metadata).
- **Identity and tenancy.** Where a session's user and organization come from, the default organization and tenant isolation are in [Authentication and tenancy](./authentication.md).
- **Listing filters.** Session and request lists filter `flowKind` (the definition) and `flowId` (the exact instance; a record with no `flowId` never matches).
- **Records with no organization.** A session or request with no `orgId` is refused on routes that address it and left out of ordinary listings.

### Which records carry an organization

| Record | Field | Required |
| --- | --- | --- |
| Session | `orgId`, column `org_id` (nullable) | Stamped on every new record |
| Request | `orgId`, `org_id` | Stamped |
| Active-request entry | `orgId`, `org_id` | Stamped |
| Wake | `orgId`, `org_id TEXT NOT NULL` | Required |
| Org record | `orgId` is the key | |
| User record | Part of the key | Required, throws without |
| User- and org-scoped resource state and content | Part of the `scope_id` | Required |
| Session-scoped resources | None of their own; they follow the session | |
| Suspension, checkpoint, lease, runOnce, items, events, traces | No org column; reached through the request | |

## Session lookup by metadata

| Fact | Detail |
| --- | --- |
| Set at create | `sessionId`, `title`, `description`, `tags`, `metadata` (a free-form object), `state` |
| `metadata` | There is no `metadata` filter on the route, the client or the store. A caller lists and filters `metadata` in memory |

The list route's parameters, ordering, editing and status codes are in [HTTP API](./http-api.md).

The lookup the server does filter is readonly state. Declare the key as a `.readonly()` field of the session's `stateSchema`, set it at create, and list on it.

```ts title="src/flows/support-desk/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";

export const supportDesk = defineFlow({
  kind: "support-desk",
  session: {
    stateSchema: z.object({ ticketId: z.string().readonly() }),
  },
  actions: {},
})();
```

```ts title="src/lib/ticket-sessions.ts"
import { createClient } from "@flow-state-dev/client";

export function ticketSessions(userId: string, orgId: string) {
  const client = createClient({ userId, baseUrl: "" });
  // The id is the session's whole key, so it names every part that tells two apart.
  const sessionIdFor = (ticketId: string) =>
    ["support-desk", orgId, userId, ticketId].map(encodeURIComponent).join("|");
  return {
    create: (ticketId: string) =>
      client.flow("support-desk").createSession({
        sessionId: sessionIdFor(ticketId),
        state: { ticketId },
      }),
    find: (ticketId: string) =>
      client.sessions.list({ flowKind: "support-desk", state: { ticketId } }),
  };
}
```

- A list on `state` needs `flowKind` or `flowId`. A field that is not readonly on that flow, or a filter with no flow, is refused `400` with the reason, not ignored.
- The filter runs in the store's query, never after it. Readonly fields are read from a `z.object` at the top of the state schema, also through an `.optional()`, `.nullable()`, `.default()`, `.readonly()` or refinement around it. A union, intersection or lazy schema at the top has no readonly fields.
- Readonly fields are the only state a client can read back besides `expose`d fields.
- `encodeURIComponent` escapes every `|`, so no two (org, user, ticket) triples join to one id. `client.flow("support-desk").identity()` returns the caller's `{ userId, orgId }`.
- A derived id is create-if-absent: a second create at it gets `409` and leaves the first record as it was. The status codes are in [HTTP API](./http-api.md).

## What a custom store must guarantee

A custom store is a `StoreAdapter` whose `resolve()` returns a registry, or part of one. Members it leaves out come from in-memory. `StoreAdapter`, `StoreRegistry`, `CapabilitySlot` and `StoresConfig` import from `@flow-state-dev/engine`, and the store interfaces from `@flow-state-dev/engine/host`. The contract is the doc comments on those interfaces, and the conformance suites in `@flow-state-dev/engine/testing`, which the built-in stores run. The member lists below name the types, and the package source is the authority for exact signatures.

| Member | Required |
| --- | --- |
| `session`, `request`, `user`, `org`, `activeRequests`, `content`, `resourceState`, `checkpoints`, `traces`, `suspensions`, `leases` | Yes, in a registry you build |
| `wakes` | No. Without it the host logs once at start: `[flow-state] this host keeps no wakes: debts are paid on their fast paths only`. A host without `wakes` does not retry work owed by a time after a crash. How this affects task-board notices is in [Task board](./task-board.md) |
| `bus` | No. An in-memory bus fills in |
| `blobs` | No. Without it the upload and read routes answer `attachments_not_configured` |
| `checkpoints.persists`, `suspensions.persists` | Set `false` only when the store keeps nothing past the process. Absent means it persists. This decides durable execution's default |

### What must be atomic

| Operation | Must be one atomic step |
| --- | --- |
| Scope `set(id, value, expectedVersion)` | Compare the stored version and write. `"any"` always writes. A number writes when the stored version equals it (`0` means a live record at version 0). `"absent"` writes when no record exists at any version. On conflict, return `{ ok: false, conflict: { currentValue, currentVersion } }`; never throw |
| Two concurrent creates at `"absent"` | Exactly one wins. The loser gets the winner's record |
| Delta verbs `patchField`, `incField`, `pushToArray`, `deleteField` (optional) | The same version check as `set`. Touch only `state`. Write the caller's `updatedAt`. `incField` treats missing or `null` as 0 and throws on a non-number. `pushToArray` treats missing as `[]` and throws on a non-array, `null` included. `"absent"` throws |
| `RequestStore.setFieldsIfStatus(id, fields, allowedStatuses, updatedAt, expectedIncarnation?)` | Check the status (and incarnation) and write. Returns `{ applied, status }`. An absent record gives `{ applied: false, status: undefined }`. An empty `allowedStatuses` matches nothing. The incarnation is an id stamped on the request record when it is created. A request id can be used again once its record is deleted, and the new record gets a new incarnation, so a caller holding a different one is addressing an earlier record with that id: the call reports it as absent and writes nothing. `fields` may move `status` together with its `result`. `setFieldsIfStatus` is the only method that writes the abort flag |
| `RequestStore.deleteIfStatus(id, allowedStatuses)` | Check the status and delete the record, items, events and runOnce results. Wait for in-flight writes to the id; do not drop them |
| `RequestStore.delete(id)` | Remove items, events and runOnce results first, then the record, only after every child delete has succeeded. Drop writes queued for the id |
| A request `set` that settles it | Land the items it carries in the same write as the status. A `set` that omits `items` keeps the stored ones |
| Resource-state `set` and `delete` | Compare the live version and write together. The first create writes `1`, each commit adds 1, and a version is never reused. `0` is create-if-absent, and a tombstone satisfies it. `"absent"` is refused by a tombstone. Snapshot the caller's value before yielding. Index entries commit with the row or not at all |
| Lease `acquire` | One active lease per request: concurrent first acquires from different holders grant exactly one. An expired lease can be taken over. A stale holder's release does not free a newer holder's lease |
| Wake `owe`, `move`, `clear` | A wake has `dueAt`, when the work is due, and `landBy`, when the run that owes the work should have finished writing. A check that finds nothing owed before `landBy` keeps the wake until `landBy` instead of clearing it. `owe` keeps one wake per key, with the earlier `dueAt` and the later `landBy`, and adds 1 to its version. `move` and `clear` take the version the caller read and apply only if the wake is at that version, so a wake written while the host is handling the old one survives |
| Resource index `completeBuild` | Add the entries and mark `built` in one commit, only if the `building` marker it began is there. A `set` leaves the key's entries as exactly the ones it lists, in the row's commit |
| `listPendingForUser` | One query joining each suspension to its request, not a read then a filter |

### Other obligations

| Member | Obligation |
| --- | --- |
| `RequestStore.persistItems(requestId, items)` | Union by item `id`, last write wins. Existing items keep their position and new ids append. Re-persisting an id whose content changed writes the latest content. Items are readable before the request settles |
| `flushItems`, `flushEvents` | Resolve when pending writes have landed. A failed write rejects |
| `countItems(requestId)` | Count without loading payloads. `0` for an unknown request |
| `isAbortRequested(requestId)` | A primary-key lookup, constant in the number of items: it runs on every heartbeat for every running request. `false` for an unknown request |
| `set` and the abort flag | Never honours `abortRequested` from a full record. The stored value survives a record that omits it, and a record that carries it cannot set one |
| `getEvents(requestId, fromSequence?)` | Events with `sequence_number > fromSequence`, sorted. No argument returns the whole log |
| `subscribeToEvents(requestId, options)` | Catch-up for `sequence_number > fromSequence`, then live, with no duplicates across the boundary. Ends on `signal.abort`, on a terminal event (`completed`, `failed`, `incomplete`, `aborted`, `suspended`, `interrupted`), or after `livenessTimeoutMs` (default 30000) of silence with a synthetic `request.interrupted`. `followThroughSuspend` keeps going past `request.suspended`. More than `maxPendingEvents` (default 1000) pending throws `StoreSubscriptionError("backpressure_overflow")`. Call `options.isStillAuthorized` after every read that returned events and before yielding any; end without yielding when it resolves `false` or throws. SQLite, filesystem, and Postgres without `liveTailPool` poll until one of those ends it. No built-in store ends after the catch-up |
| `getRunOnceResult`, `setRunOnceResult` | `{ found, value }`. `set` replaces any prior value for `(requestId, key)`. Removed when the request is deleted; deleting `r` leaves the results of an id that merely starts with `r` |
| `RequestRecord` fields | Persist `finalizedAtMs` (`null` means not finished, absent means unknown; tell them apart with `=== null`), `heartbeatsUntilFinalized`, `incarnation` (the id described under `setFieldsIfStatus` in [What must be atomic](#what-must-be-atomic): stamped once at creation, carried unchanged), `result` (its shape is in [HTTP API](./http-api.md)), `spentByModel`, `spentThroughItemIndex`, `spentHarnessRuns`, `source` (a record without one reads as `"http"`), `attachments`, `historyStart` |
| `SessionRecord` fields | Persist `flowId`, `parentSessionId`, `lineageId`, `topic`, `coordinate`. An unset field may read back `null` from a store that nulls absent keys, so guard `== null` |
| Filters | `tenantId` and `orgId` as present-versus-absent exact match, safe with NULL. `parentage` and `flowId` as below |
| `ContentStore` | `get`, `set` (create or overwrite, last write wins), `delete`, `getAll`, `getByPrefix` (an empty prefix returns all; wildcards are literal), `deleteAll`. Keyed `(scopeType, scopeId, resourceKey)` |
| `ResourceStateStore` | Reads return live rows only; a tombstone reads as absent. `delete` keeps the version and drops the payload. `deleteAll` tombstones the scope. `purgeTombstones` is the only reclaim. A numeric `expectedVersion` must be a non-negative integer, or it throws `TypeError`, never a conflict. A row with no version reads as live at version 1. Every state crossing the boundary is a deep copy |
| `ResourceStateStore.indexes` | All four verbs (`state`, `beginBuild`, `completeBuild`, `findKeys`) or none. Without them, lookups scan |
| `CheckpointStore` | Latest only per `(requestId, blockInstanceId)`. `delete` at sequencer end. `deleteForRequest` is idempotent |
| `SuspensionStore` | `set`, `get`, `list`, `deleteForRequest`, `pruneTerminalBefore(cutoff, limit)` (never touches pending; returns rows deleted), `listPendingForUser` |
| `TraceStore` | `appendEvent`, `flush`, `getEvents(requestId, fromSequence?)` (exclusive lower bound), `listRequestIds` (insertion order). Bounded retention is the store's job |
| `ActiveRequestRegistry` | `register`, `heartbeat`, `deregister`, `listStale(thresholdMs)`, `listAll`, `get`. Declare `sharedAcrossProcesses`: absent means not shared |
| Retention | Session `retention` deletes whole past requests, only once `finalizedAtMs` is set, through `deleteIfStatus`. Its settings are in [Flows and actions](./flows.md) |

### List filters a store applies in its query

| Option | Contract |
| --- | --- |
| `SessionListOptions.parentage` | Omitted or `"top-level"`: only sessions with no parent. `"all"`: every session. `{ parentOf: id }`: that session's children. A `null` parent counts as none. An absent `parentage` narrows, where an absent `tenantId` or `orgId` widens |
| `SessionListOptions.state` | Exact match on top-level state fields with string values. The route admits only `.readonly()` fields of the addressed flow |
| `SessionListOptions.orderBy` | `"updatedAt"` (default) or `"createdAt"`, ordered `(createdAt, id)` so paging neither skips nor repeats a written row |
| `RequestListOptions.sessionId` | One id (equality) or an array (set membership; empty matches nothing) |
| `RequestListOptions.status` | One status or an array. An empty array matches nothing; it is not "no filter" |
| `RequestListOptions.orderBy` | `"updatedAt"` (default), `"startedAtMs"` (`(startedAtMs, id)`), or `"none"` (unordered; with `limit: 1` it stops at the first match) |
| `RequestListOptions.withItems` | Default `false`: SQLite and Postgres leave `items` off. In-memory and filesystem keep items on the record and return them whatever the flag |
| `limit`, `offset` | On every list |

Each member's conformance suite is exported from `@flow-state-dev/engine/testing`, listed in [Engine API](./api/engine.md).

## Concurrency and sharing

| Store | Scope-state and resource-state writes | Several processes on one store |
| --- | --- | --- |
| In-memory | Atomic in the store | Each process has its own data |
| Filesystem | Per-record and per-key lock on the store instance | Not supported. Two instances over one directory race: both create-if-absent calls can succeed, and one record can overwrite another |
| SQLite | Atomic: one transaction per write, and the status-checked writes take the write lock first | One writer at a time (a second waits up to 5000 ms, then `SQLITE_BUSY`). Readers run beside it. `sharedAcrossProcesses` is `false`. Does not back `bus` |
| Postgres | Atomic in the store. Schema init runs under an advisory lock | Every connection to the database. `sharedAcrossProcesses` is `true` for `connectionString` and `{ pool }`. Backs `bus` |

- **Increments and appends combine; other writes replace.** `incField` and `pushToArray` apply to the value the store holds when they run, so concurrent increments and appends both land on a built-in store. `patchField` replaces. The filesystem session, user and org stores have no `deleteField`, and no store has it on the request record.
- **Separate dispatch and worker processes** must share one durable store, and a cancel reaches a request in another process only through a shared request store. Both are in [Background work](./background-work.md).
- **After a restart**, an in-flight request on a store that persists reads `interrupted` once its last heartbeat is stale and a sweep has run. In memory, the registry and record die with the process, so nothing is marked. A suspended request is left alone.

## Cost per request

| What | Cost |
| --- | --- |
| Items, SQLite and Postgres | One row per item in `request_items`, upserted by `(request_id, item_id)`. Only items whose serialized content changed since the last write are written. A block's `block_trace` item keeps one row in `request_items`, rewritten when its status moves from `in_progress` to `completed` and left alone by writes that did not change it |
| Items, filesystem and in-memory | Inline on the request record. Every item write reads, merges and writes the whole record, so the cost grows with the number of items. `countItems` reads the record |
| Settling write | Lands the final items and the status together |
| Events, SQLite and Postgres | One row per event in `request_events` |
| Events, filesystem | Appends only the new events to one NDJSON file per request |
| `list()` | SQLite and Postgres read no items unless `withItems: true`. Filesystem and in-memory return the items on each record either way |
| `countItems` | An indexed `COUNT` on `request_items` (SQLite, Postgres). A record read on the filesystem. Used by retention's `maxItems` |
| Abort check | One primary-key read per heartbeat per running request. A `stat` of the `.abort` marker on the filesystem. The heartbeat interval is in [Runtime configuration](./runtime.md) |
| Checkpoint | One row per (request, sequencer instance), overwritten at each step boundary and each pause, and deleted when the sequencer ends. Constant however many steps |
| runOnce | One row (or file) per distinct key per request |
| An open session view | With a [bus that crosses processes](#the-change-bus), it reads the store after each change notice, at most once a second. Otherwise it reads once a second. A view of a quiet session costs nothing on a crossing bus. Connection behaviour is in [Items and the stream](./items.md); client timers are in [Client configuration](./client.md) |
| Schema init | SQLite: on open unless `skipSchemaInit`. Postgres: on every create unless `skipSchemaInit`. `vercelPostgresStores` skips it |

How much history a request loads and when old requests are evicted are session settings in [Flows and actions](./flows.md). Resource deletes and their rows are in [Resources and collections](./resources.md).

## The change bus

A bus carries notices that something under a topic changed. It never carries rows, delivers at most once, and publishes only once the change can be read. Every request and session write that lands publishes. A write that did not land (a version conflict, a failed status check) publishes nothing, and neither does `persistEvents`. An open session view reads the store after a notice.

| Member | Meaning |
| --- | --- |
| `publish(notice)` | A failure must not fail the write |
| `subscribe(topic, listener)` | A topic is `{ scope, id, tenantId, resource? }`. A subscriber to a scope hears every notice under it. One narrowed to a resource hears only that resource's |
| `crossesProcesses` | `true` only while a change in any process serving the app reaches this one. While true, session views stop their timed read and clients stop their fallback polls, so a wrong `true` is a view that stops updating |
| `onCrossingChange(listener)` | A change to `false` puts waiting views back on the timed read |

| Bus | Behaviour |
| --- | --- |
| In-memory (the default, and what a SQLite profile gets) | `crossesProcesses` is always `true`, even when another process writes the same SQLite file, so views on it do no timed read. It is right for an app that runs as one process. `createInMemoryBus()` from `@flow-state-dev/engine/host` lets an adapter fan out in-process |
| Postgres | One `LISTEN` connection per process, taken from the tail pool by the first subscriber and handed back by the last. A process with no open view (a worker, `fsdev run`) publishes and holds none. It pings itself every 2 s and says it crosses while it hears its own ping. Unheard for 3 s, or connection lost, it says it does not, views go back to the once-a-second read, it reconnects with backoff (100 ms to 30 s), sends each subscriber one `resync` notice, and says it crosses again on the next ping heard. A payload of 8000 bytes or more drops its ids and task-board partition first, then its resource narrowing, and goes out as the bare scope. A transaction-mode pooler accepts `LISTEN` and delivers nothing; the ping is how that shows |
| Postgres with no tail pool | `{ executor }` or `{ pool }` without `liveTailPool`, or `liveTailPool: null`: it never listens and never says it crosses. Writes notify for `{ pool }` (so `vercelPostgresStores`) and a connection string. `{ executor }` with no tail pool sends no notices |
| Your own registry | A `StoreRegistry` you build can set `bus`. The engine otherwise fills an in-memory bus |

With Postgres and several servers, a view open on one server sees a change saved on another as soon as it is saved, with no configuration.

On SQLite, a write from another process reaches an open view only when a change made in the view's own process wakes a read of that session, or when the view reconnects (the server closes each session stream after 15 minutes and the client reconnects). That covers several servers on one SQLite file, and `fsdev run` or `fsdev chat` writing the SQLite file a running `fsdev dev` reads.

Which store each `fsdev` command opens, and `--store`, are in [CLI](./cli.md).

## Trace store

Traces are kept in memory by default (and by the Postgres adapter). The in-memory, filesystem and SQLite factories take a `traceStore` option: `createInMemoryStores({ traceStore: { maxRequests, maxBytesPerRequest } })`, `filesystemStores({ traceStore: { maxRequests } })`, `sqliteStores({ traceStore: { maxRequests } })`. The event record, retention and what a failed write does are in [Items and the stream](./items.md).

## Next

- [Persistence](../concepts/persistence.md): what a store is for and how a request reaches it.
- [Resources and collections](./resources.md): the options behind resource state and content.
- [Pause, resume and replay](./durable-execution.md): checkpoints, suspensions and leases from the flow's side.
- [HTTP API](./http-api.md): the session and request routes that read these records.
