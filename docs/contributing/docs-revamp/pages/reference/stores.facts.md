# Fact sheet: Stores (R-16, reference, `reference/stores`)

Pass 1. Cites only: existing user docs (`apps/docs/**`), the exported surface and its doc comments, tests,
`goals/`, and the examples under `labs/`. No spec was read. Rows other pages' depth passes moved here (the
`→ R-16` rows in the `*.record.md` files) are checked in section 16; every one is carried or named as dropped.

**[impl]** marks an observable behaviour I could confirm only in a non-exported function body or a SQL
schema (a table name, a column, a key format). Pass 5 should confirm each by a test or a run before the page
states it. **[run]** marks a behaviour I ran myself in this pass (the command is in the row).

Source abbreviations (all under `/home/user/flow-state-dev/`):

| Abbr | File |
|---|---|
| `ty` | `packages/engine/src/stores/types.ts` |
| `sk` | `packages/engine/src/stores/scope-keys.ts` |
| `si` | `packages/engine/src/stores/index.ts` |
| `fs` | `packages/engine/src/stores/filesystem/` (`frs` request-store, `fsh` shared, `frk` resource-state-store, `ftr` trace-store, `far` active-request-registry) |
| `mem` | `packages/engine/src/stores/memory/` |
| `eh` / `ei` / `et` | `packages/engine/src/host.ts` / `index.ts` / `testing.ts` |
| `cfs` | `packages/engine/src/flowstate/createFlowState.ts` |
| `rs` | `packages/engine/src/flowstate/resolve-slots.ts` |
| `sr` | `packages/engine/src/routes/session-routes.ts` |
| `ru` | `packages/engine/src/routes/route-utils.ts` |
| `ss` | `packages/engine/src/routes/session-stream-routes.ts` |
| `ra` | `packages/engine/src/execution/runAction.ts` |
| `lt` | `packages/engine/src/stores/testing/*-conformance.ts` |
| `sq` | `packages/store-sqlite/src/` (`sqs` schema.ts, `sqr` registry.ts, `sqq` request-store.ts) |
| `pg` | `packages/store-postgres/src/` (`pgs` schema.ts, `pgr` registry.ts, `pgb` bus.ts, `pgt` types.ts) |
| `vz` | `packages/vercel/src/` (`store.ts`, `pg.ts`) |
| `fd` | `packages/fsdev/src/local-store.ts` |
| `cl` | `packages/client/src/client.ts` (`clt` = `client/src/types/index.ts`) |
| `core` | `packages/core/src/types/` |
| `ov` | `apps/docs/docs/persistence/overview.md` (line numbers are the page's own) |

## Pass 8 (revise round 1): what the page no longer states

The page was cut to the rows below; the sections named stay on this sheet as the record of what was checked, and the
owning Reference page states them. Where this sheet and the page differ, the page is the shorter one on purpose.

- Moved out, linked from the page: suspension record fields and `blockInstanceId` (durable-execution); the `durable`
  option; profile selection (runtime); heartbeat interval (runtime); client `pollIntervalMs` and `client.live`
  (client); session stream connection, trace event record, retention and failed-write behaviour (items); session
  identity, default org, session id collisions, tenants (authentication); records with no org (the release's
  Upgrading page); session list route, create status codes, `updateMetadata`, request `result` and failed-request
  record (http-api); no-wake-store effect on board notices (task-board); schedule-index row (schedules); MCP
  credential (mcp-server); resource key forms and tombstones (resources); `retention` and `historyWindow` (flows);
  split dispatch and worker processes, abort across processes (background-work); `--store` and default stores per
  command (cli); `vercelPostgresStores` options (api/vercel); `/host` and `/testing` export names (api/engine).
- Cut: section 14 hosts table and the SQLite native-build and `libsqlite3` rows (unchecked deployment advice); the
  "O(N^2)" warning commentary in section 2.1 "Not exact" (a defect in the warning text, to be reported as a bug).
- Kept, with the page's wording changed: wake, defined on first use as a stored note that a session owes work by a time; `dueAt` and `landBy` are explained in the atomicity row (`dueAt` is when the work is due, `landBy` is the
  time by which the write it guards must have landed; `ty:1851-1864`). The wake atomicity row stays in the custom-store
  contract because Quick answers and the contract must list it.
- Corrected: the filesystem store's warning is not production-only. `createFilesystemStores` never reads `NODE_ENV`
  and warns once per process in any environment unless `developmentOnly: true` (`si:222`). The page row is "Warning".
- Unverified, now off the page: section 14a's claim that a retry gives the same `blockInstanceId`; see 14a.

## 0. What the page is, and the four questions

A store is where the framework keeps what has to outlive a function call: sessions, requests and their items,
user and org state, resource state and content, and what durable execution needs to continue a run. An app
names its store once, on `createFlowState({ stores })`, as an adapter. Four adapters ship: in-memory (the
default), a folder of files, SQLite, Postgres.

The page is a Reference page: tables and signatures, no narrative. Tables from the page plan: what each store
persists; who owns a record and what keys it; what a custom store must guarantee; session lookup by metadata;
cost per request. Lookups: what must a custom store do atomically; which records carry an organization.

### The four questions, per stored part

"Owns" is the identity the record belongs to. "Sees" is who can read it through a public route or the client.
"Where" is the store member and (SQLite / Postgres) the table. "How many" is the count.

| Stored part | Who owns it | Who can see it | Where it is stored | How many exist |
|---|---|---|---|---|
| **Session record** (`SessionRecord`: state, title, description, tags, metadata, journal) | One user (`userId`), one organization (`orgId`), one tenant when the caller sent one, one flow instance (`flowId`, with `flowKind` as the definition). `userId`, `orgId` and `flowId` are stamped at creation. | The owner, through the session routes. A client sees `state` fields the flow `expose`s or declares `.readonly()`, plus `title`, `description`, `tags`, `metadata`; never `journal` or `resources`. | `stores.session`; table `sessions`, primary key `id` = the storage key (tenant-prefixed when there is a tenant). | One per session id per tenant. Created `409` when the id exists. |
| **Request record** (`RequestRecord`) | Same four owners as its session, stamped when the request starts. | Its owner: another user's, another tenant's or (when the record carries one) another organization's request answers as a missing one (`404`). | `stores.request`; table `requests`, primary key `id` (the request id). | One per request. Many per session. |
| **Request items** (the item log) | The request. | The owner, through the request and session routes, filtered per item visibility. Transient items are never stored. | In the request store; SQLite and Postgres `request_items` (one row per item, key `(request_id, item_id)`); filesystem and in-memory: on the record. | One per item id per request. |
| **Request stream events** | The request. | The owner, through the request stream route. | `request_events`, key `(request_id, sequence_number)`; filesystem: `<id>.events.json` (NDJSON). | One per event, per request. |
| **runOnce results** | The request. | Nobody through a route [impl: no route reads them]. | `request_runonce`, key `(request_id, key)`; filesystem `<id>@<key>.runonce`. | One per distinct key per request. |
| **User record** (`UserRecord`: `ctx.user.state`) | One user in one organization (the key carries both), per flow when the flow isolates user state. | The user's own flows; a client sees only `expose`d fields. | `stores.user`; table `users`, primary key = the user cell key. | One per (user, org), or per (user, org, flow) when isolated. |
| **Org record** (`OrgRecord`: `ctx.org.state`) | One organization, per flow when the flow isolates org state. | Flows run in that org. | `stores.org`; table `orgs`; filesystem directory `projects/`. | One per org, or per (org, flow) when isolated. |
| **Resource state** | The scope instance the resource is declared at: a session, a (user, org) cell, an org. A `sharedToLineage` session resource stores under the lineage instead. | See the Resources reference. | `stores.resourceState`; table `resource_state`, key `(scope_type, scope_id, resource_key)`. | One per resource key per scope instance, plus one tombstone row per deleted key. |
| **Resource content** | Same as its state. | Same as its state. | `stores.content`; table `resource_content`, same key. | One per resource key, or none until written. |
| **Resource index entries** | The scope instance. | Nobody; a lookup reads them. | `resource_index`, `resource_index_built` (SQLite and Postgres only). | One row per (row, index, value). |
| **Sequencer checkpoint** | The request. | Nobody through a route (goal `durable-by-default` says "Checkpoints have no public route"). | `stores.checkpoints`; `sequencer_checkpoints`, key `(request_id, block_instance_id)`. | Latest only: one per (request, sequencer instance), overwritten; deleted when the sequencer ends. |
| **Suspension record** | The request's user (`userId`) and flow instance (`flowId`). | The request's owner; a user's pending stops are listed to that user. The debug endpoints (off unless `debugEndpointsEnabled`) list them too. | `stores.suspensions`; `suspension_records`, key `(request_id, suspension_id)`. | One per `ctx.suspend()` call. Kept until pruned. |
| **Resume lease** | The request (key = request id). | Nobody. | `stores.leases`; `leases`, primary key `request_id`. | At most one active per request. |
| **Wake** | The session's owner: flow kind, user, org, tenant. | Nobody. | `stores.wakes` (optional); `wakes`, key `(tenant_key, session_id, entry)`. | One per (tenant, session, entry). |
| **Active-request entry** | The request. | Nobody directly; it drives `interrupted` marking and cross-process abort. | `stores.activeRequests`; `active_requests`; filesystem `active-requests.json`. | One per in-flight request; removed at the end. |
| **Trace events** | The request. | The DevTool and debug reads. | `stores.traces`; SQLite `trace_events` + `trace_request_roster`; filesystem `traces/`; in-memory (also what Postgres uses). | Bounded: see section 12. |
| **Attachment bytes** | The session (deleted with it). | The session's owner, through the upload and read routes. | The `blobs` slot, not the primary: `.fsdev/blobs/<profile>/` under the working directory when the primary persists; `<rootDir>/blobs` for the filesystem store; memory otherwise. | One per upload. |
| **Schedule-index row** | The schedule's cell, run as `user_id` in `org_id`. | Nobody. | `schedule_index`, key `(cell, key)`. Not in `StoreRegistry`. | One per schedule. |
| **MCP key** (the Lab's) | One user, in one organization, per MCP server. | The user, who can read `setAt` only. The key never reaches a browser, an answer, or a debug read. | A user-scope resource collection `mcp-credentials/<server>` in the host's own store, in the user's cell, shared across flows. | One per (user, org, server). |

Sources by row: session: `ty:35-138`, `sr:381-515` (create), `packages/engine/src/routes/client-session.ts:1-40`
(what a client sees); request: `ty:140-306`, `ru:191-213` (`callerReachesRequest`), `context/request-principal.ts:41-54`;
user/org: `ty:423-432`, `sk:177-227`; resources: section 4; checkpoint: `ty:1692-1722`,
`goals/durable-by-default/a-local-stop-is-held-and-answered/goal.md:12`; suspension: `core/suspension.ts:44-110`, `ty:1757-1806`;
lease: `ty:1808-1833`; wake: `ty:1835-1904`; active request: `ty:1146-1227`; traces: `ty:1724-1755`; blobs: `rs:70-73,132-144`,
`ty:1934-1940`, `sr:517-545` (session delete removes them); schedule index: `sqs:531-541`; MCP key:
`packages/workforce/src/projects/mcp-credentials.ts:1-100`, `packages/shift-manager/src/lib/mcp-credentials.ts:1-8`.

## 1. Declaring stores

| Fact | Detail | Source |
|---|---|---|
| Where | `createFlowState({ stores })`. Accepts one adapter (becomes the `default` profile's `primary`), or a map of named profiles. A bare adapter is told from a profile map by its `resolve` function and `capabilities` array. | `ei` root `createFlowState`; `cfs:247-251`, `ty` n/a; `packages/engine/src/flowstate/types.ts:211`; `packages/engine/test/flowstate/stores-shorthand.test.ts:132-148, 164-175` `[T]` |
| Profile | A map of capability slots to adapters: `primary` (required), `bus`, `blobs`. | `packages/engine/src/stores/store-adapter.ts:21-33` |
| `primary` backs | sessions, requests, users, orgs, active requests, checkpoints, content, resource state, traces, suspensions, leases, wakes. | `store-adapter.ts:21-24`, `ty:1906-1941` |
| `blobs` slot | Attachment bytes. Not a no-op. A primary that declares `blobs` backs it (the filesystem store: `<rootDir>/blobs`); otherwise it defaults to `.fsdev/blobs/<profile>` under the working directory when the stores persist, in memory when they don't. | `rs:70-73,125-144`, `si:288-308` |
| `bus` slot | The change bus. A primary that declares `bus` backs it (Postgres, `vercelPostgresStores`). Otherwise an in-memory bus, for one process. | `store-adapter.ts:25-28`, `ty:1925-1932`, `pgr:249-267`, `vz/store.ts:139-142` |
| `queue`, `scheduler` slots | Not in the slot map. **Contradiction with `ov:11`**, which says `blobs`, `queue` and `scheduler` exist and are no-ops. The map has `primary`, `bus`, `blobs` only. | `store-adapter.ts:29-33` |
| Capabilities by adapter | in-memory `["primary"]`; filesystem `["primary","blobs"]`; SQLite `["primary"]`; Postgres `["primary","bus"]`; `vercelPostgresStores` `["primary","bus"]`. | `si:274,294`, `sqr:98`, `pgr:259`, `vz/store.ts:141` |
| Profile selection | First `ready()`/`getRouter()` call: `FSD_ENV` (must name a declared profile, else throws), then `defaultProfile`, then the first declared. `NODE_ENV` is not read. | `apps/docs/docs/server/setup.md:123-131` (page only; the code path is `#resolveProfileName`, `cfs`) [impl] |
| Import paths | App author: `inMemoryStores`, `filesystemStores`, `createFlowState`, and the types `StoreAdapter`, `StoreRegistry`, `CapabilitySlot`, `StoresConfig`, from `@flow-state-dev/engine`; `sqliteStores` from `@flow-state-dev/store-sqlite`; `postgresStores` from `@flow-state-dev/store-postgres`; `vercelPostgresStores` from `@flow-state-dev/vercel/store`. Host and store authors: store types, `createFilesystemStores`, `createInMemoryStores`, `createInMemoryBus`, `isBatchStillAuthorized`, `pollEvents` from `@flow-state-dev/engine/host`; `createSQLiteStores` from `@flow-state-dev/store-sqlite/host`; `createPostgresStores` from `@flow-state-dev/store-postgres/host`; conformance tests from `@flow-state-dev/engine/testing`. | `ei:1-22`, `eh:20-105,216-218`, `store-sqlite/src/index.ts:1-12`, `store-postgres/src/index.ts:1-12`, `vercel/package.json:39`, `et:1-62` |

### 1.1 The default store

| Fact | Detail | Source |
|---|---|---|
| No `stores` | The app runs on `inMemoryStores()`: nothing persists across a restart. | `cfs:247-251`; `stores-shorthand.test.ts:103-112` `[T]` |
| Startup line | Once per process per profile, on stderr: `[flowstate] active profile: "<name>" (no \`stores\` set: the app runs in memory, and nothing persists across a restart)`. With `stores` set, the same line without the parenthesis. | `cfs:1018-1031`; test `:103-112` |
| Production warning | With `stores` never set and `NODE_ENV=production`: one warning per process, text starting "createFlowState has no `stores`, so this production app runs in memory and loses its sessions and requests on every restart. Set `stores` to a persistent adapter, such as `stores: postgresStores({ connectionString })`." Not given when `stores` was set to the in-memory adapter on purpose, nor outside production. | `cfs:1033-1041`; test `:114-130` `[T]` |
| Durable execution follows the store | On by default when the stores persist (filesystem, SQLite, Postgres); off over in-memory stores, because a suspension would be lost with the process. `durable: true` forces it on in memory (tests; a paused run then survives only in that process); `durable: false` turns it off. | `packages/engine/src/flowstate/types.ts:337-352`, `packages/engine/src/durability/default-durability.ts:19-31`; `mem/checkpoint-store.ts:12-17`, `mem/suspension-store.ts:23-28` (`persists = false`) |
| In-memory cannot continue a crashed run | A checkpoint or suspension in memory dies with the process; there is nothing to continue from. | same |
| `StoreRegistry` fills missing members from in-memory | A profile whose adapters leave a member out gets the in-memory one. | `rs:123-128` |

## 2. What each store persists

| | In-memory | Filesystem | SQLite | Postgres |
|---|---|---|---|---|
| Factory (app) | `inMemoryStores(options?)` | `filesystemStores({ rootDir, ... })` | `sqliteStores({ filename, ... })` | `postgresStores({ connectionString?, ... })` |
| Survives a restart | No | Yes | Yes | Yes |
| Sessions, requests, items, events, runOnce | Process memory | JSON files, NDJSON for events | Tables | Tables (JSONB) |
| User, org records | memory | files | tables | tables |
| Resource state and content | memory | files, a browsable tree | tables | tables |
| Resource index | none (lookups scan) | none (lookups scan) | tables | tables |
| Checkpoints, suspensions, leases, wakes | memory (`persists = false`) | files | tables | tables |
| Active-request registry | memory | `active-requests.json` | table | table |
| Traces | memory | `traces/` NDJSON | tables | **memory** (`createInMemoryTraceStore()`) |
| Attachment bytes (`blobs`) | memory | `<rootDir>/blobs` | `.fsdev/blobs/<profile>/` in the working directory | same as SQLite |
| Backs `bus` | No (default in-memory bus) | No | No | Yes |
| Registry shared across processes (`sharedAcrossProcesses`) | false | false | false | true for `connectionString` and `{ pool }`, false for `{ executor }` |

Sources: `si:187-212` (in-memory registry members), `si:215-263` (filesystem), `sqr:59-88`, `pgr:225-246`
(`traces: createInMemoryTraceStore()` at `pgr:236`), `rs:132-144`, `mem/active-request-registry.ts:12`,
`fs/far:43`, `sq/active-request-registry.ts:109`, `pg/active-request-registry.ts:89-97`, `pgr:91-100`,
`ty:1191-1208` (`sharedAcrossProcesses` absent means NOT shared). `ResourceStateStore.indexes`: "Absent on a store
that does not (memory, filesystem): the engine answers a lookup there by scanning" `ty:1683-1688`.

### 2.1 The filesystem store

| Fact | Detail | Source |
|---|---|---|
| Option | `rootDir` is required, no default. Created on first write (`mkdir -p`). | `si:136-140`; `fsh:20-22` |
| Layout under `rootDir` | `sessions/`, `requests/`, `users/`, `projects/` (the org records; the directory name is kept from before the `project` to `org` rename), `content/`, `state/`, `checkpoints/`, `traces/`, `suspensions/`, `leases/`, `wakes/`, `blobs/`, `active-requests.json`. | `si:229-262`, `fs/checkpoint-store.ts:47`, `fs/active-request-registry.ts:52-55`, `si:292-300` |
| Resource files | Key `notes/meeting` becomes `content/<scope>/<scope id>/notes/meeting.md` and `state/<scope>/<scope id>/notes/meeting.json`, where `<scope>` is `session`, `user`, `org` (and `lineage`). Segments are percent-encoded; every `.` in a segment is escaped, so the only `.` is the extension. | `fs/resource-path.ts:1-45`, `fs/content-store.ts:1-28`, `fs/resource-state-store.ts:1-30` |
| State file shape | One file per resource: a JSON array `["fsdev.resource-state/1", version, lifecycle, state]`; version and state commit together in one rename. | `fs/resource-state-store.ts:8-24` |
| Request files | `requests/<id>.json` holds the record with its items inline; `<id>.events.json` is append-only NDJSON; `<id>.abort` is the cancel marker; `<id>@<key>.runonce` is one file per runOnce key. | `frs:54-60,84-97,135-147` |
| Writes | Crash-safe: temp file then rename. | `fsh:24-37` |
| One store instance only | A per-record lock (scope records, requests) and a per-key lock (resource state) live in memory on the store instance. They cover every write through that instance. Two store instances over one directory, in one process or two, are not coordinated. | `fsh:311-342`, `fs/resource-state-store.ts:26-33`, `frs:148-154` |
| Development only | `createFilesystemStores` warns once per process unless `developmentOnly: true`: "the filesystem store's O(N^2) event persistence is unsuitable for production load. Use createSQLiteStores ... or pass { developmentOnly: true }". The flag changes no behaviour. `filesystemStores` takes the same options. | `si:155-161,215-231`; `packages/engine/test/filesystem-store-development-only.test.ts:27` `[T]` |
| `onPersistError` | Called when a background write (requests, traces, active-request registry) fails, before the logged failure. | `si:147-153`, `ty:1944-1962` |
| Not exact | The warning text says "O(N^2) event persistence"; the request store appends only new events (`persistEvents` appends NDJSON, O(new events)). Items are the O(items) part (section 10). | `frs:135-139,581-607` |
| Deletion order of a session | Content, state and blobs first, then the session record. | `sr:529-545` |
| Cannot be shared | Not shared across replicas or concurrent processes. | `frs:148-154` ("NO inter-process locking ... not a supported topology") |

### 2.2 The SQLite store

| Fact | Detail | Source |
|---|---|---|
| Package | `@flow-state-dev/store-sqlite`. Depends on `better-sqlite3` `^11.0.0` (a native module); Node `>=22`. | `packages/store-sqlite/package.json:59-67` |
| Options | `filename` (path, or `":memory:"`); `skipSchemaInit` (default `false`; PRAGMAs are always applied); `traceStore: { maxRequests }`; `requestStore` (live-tail options). | `sqr:34-47` |
| The file | Created when missing. Its directory is not: opening a path in a folder that does not exist throws "Cannot open database because the directory does not exist". `fsdev` makes `.fsdev/data` first. | **[run]** `node` with `better-sqlite3@11.10.0`, `new Database("/tmp/.../nonexist-dir-xyz/a.db")`; `fd:70-75`; `store-sqlite/README.md:30-40` |
| PRAGMAs applied on every open | `journal_mode = WAL`, `busy_timeout = 5000`, `synchronous = NORMAL`, `cache_size = -20000`, `foreign_keys = ON`, `temp_store = MEMORY`. | `sqs:3-10`, `sqr:61-66` |
| One writer at a time | A second writer (same process, another connection, or another process) waits up to 5000 ms for the lock, then fails with `SQLITE_BUSY`. Readers are not blocked by a writer (WAL). | **[run]** two processes on one WAL file with these PRAGMAs: writer held the lock 7 s; the second writer failed `SQLITE_BUSY` after 5009 ms; a reader read while it was held. With a 2 s hold the second writer succeeded after 1432 ms. `/tmp/claude-0/.../scratchpad/busy.mjs`. |
| Schema | Created on open, idempotent: `sessions`, `requests`, `users`, `orgs`, `active_requests`, `request_items`, `request_events`, `request_runonce`, `resource_content`, `resource_state`, `resource_index`, `resource_index_built`, `sequencer_checkpoints`, `trace_request_roster`, `trace_events`, `schedule_index`, `suspension_records`, `leases`, `wakes`. | `sqs:14,79,122,133,146,376,389,406,422,442,452,469,489,502,512,531,551,569,583` |
| `skipSchemaInit` | Skips DDL on open. A database opened that way must already have the tables: run the schema step first, including the resource-index tables. | `sqr:37-42`, `store-sqlite/README.md` ("Resource persistence") |
| `close()` | `createSQLiteStores` returns a registry with `close()`; the adapter disposes it. | `sqr:49-52,84-86,102-106` |
| `sharedAcrossProcesses` | `false` always: the adapter cannot tell whether the file is on a volume every worker opens. | `sq/active-request-registry.ts:109`; `store-sqlite/README.md` ("Interrupted Request Recovery") |
| Change bus | Does not back `bus`, so each process gets its own in-memory bus, whose `crossesProcesses` is always `true`. An open session view therefore does no timed read: another process's write to the file is not pushed, and reaches the view only when a change in the view's own process wakes a read of that session, or when the view reconnects (the server closes a session stream after 15 minutes; the client reconnects). | `sqr:98`, `fd:1-14`, `packages/engine/src/flowstate/resolve-slots.ts:62-68`, `bus/publish-writes.ts:130-131`, `bus/in-memory-bus.ts:36-42`, `ss:111-115,414-489`, `packages/client/src/types/index.ts:682-690`; `packages/engine/test/bus/change-bus.test.ts:90-92` `[T]` |
| Native module | Vendors the SQLite sources (`deps/sqlite3`) and builds `better_sqlite3.node` for the install platform; no system `libsqlite3` is read. Build on the platform that runs it. | **[run]** `node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/deps/sqlite3`, `build/Release/better_sqlite3.node` listed; `apps/docs/guides/deploying-with-docker.md:390-392` |
| Starter example | `labs/teammates` opens `sqliteStores({ filename })` at `labs/teammates/.fsdev/teammates.sqlite` (git-ignored; `TEAMMATES_STORE` overrides). One conversation per worker per user; the starter runs as one user. | `labs/teammates/host.mts:14,58,102`; `labs/teammates/README.md:211`; `labs/teammates/.gitignore:2`; `packages/workforce/src/workers/derive-session-id.ts:1-20` |

### 2.3 The Postgres store

| Fact | Detail | Source |
|---|---|---|
| Package | `@flow-state-dev/store-postgres`; depends on `pg ^8.13.0`. | `store-postgres/package.json:60-68` |
| Options (connection-string shape) | `connectionString` (defaults to `FSD_DB_URL`, then `DATABASE_URL`; throws "no connection string provided" when neither nor `poolOptions` host is set), `max` (10), `connectionTimeoutMillis` (10000), `idleTimeoutMillis` (30000), `poolOptions` (merged over those, caller wins), `createPool`. | `pgr:127-166`, `pgt:43-90` |
| Other shapes | `{ pool }` (your `pg.Pool`), `{ executor }` (a `QueryExecutor`, for example PGlite; process-local). | `pgr:51-63,102-125` |
| `skipSchemaInit` | Default `false`. On a connection-string store, schema init runs on every `createPostgresStores` call: idempotent, under an advisory lock, on one dedicated client; tries the lock up to 20 times, 500 ms apart (10 s), and if it never gets it logs "could not acquire schema advisory lock; skipping init" and goes on. With `{ pool }` or `{ executor }` the init runs under a blocking advisory lock. `skipSchemaInit: true` runs none, for a migration run out-of-band. | `pgr:182-187,211-213`, `pgs:840-935`, `pgt:43-49` |
| Tail pool | `liveTailPool` omitted: a connection-string store makes its own pool (`max` from `LIVE_TAIL_POOL_MAX`, default 10) for `LISTEN`; `{ pool }` and `{ executor }` get none unless you pass one; `null` turns `LISTEN` off. | `pgr:27-35,189-208`, `pgt:50-69` |
| Tables | Same names as SQLite except no `trace_*` tables (traces are in memory); JSONB for payloads. | `pgs:9,42,174,188,204,421,435,467,477,496,512,532,554,574,593,660,677`, `pgr:236` |
| `close()` | Hands back the bus's listening connection, then ends the pools. | `pgr:241-245` |
| Change bus | Backs `bus`. See section 11. | `pgr:259` |
| Item id limit | An item id longer than 2600 characters is refused (B-tree index row size). SQLite applies the same limit. | `pg/request-store.ts:58,316-324`, `sqq:38` |

### 2.4 `vercelPostgresStores()`

| Fact | Detail | Source |
|---|---|---|
| Import | `@flow-state-dev/vercel/store`. Options: `{ connectionString? }`. | `vz/store.ts:35-41` |
| Connection string | `connectionString`, then `FSD_DB_URL`, then `DATABASE_URL`; none: throws "vercelPostgresStores: no connection string. Set FSD_DB_URL / DATABASE_URL or pass { connectionString }." | `vz/store.ts:72-82` |
| Pool | `vercelPgPoolOptions`: `idleTimeoutMillis` 10000, `connectionTimeoutMillis` 15000, `max` 1, `allowExitOnIdle` true. | `vz/pg.ts:38-50` |
| Neon | A URL containing `.neon.tech` gets `@neondatabase/serverless`'s WebSocket `Client`. | `vz/store.ts:89-94` |
| Schema | `skipSchemaInit: true`: migrations run at build, not at cold start. | `vz/store.ts:119-127` |
| `LISTEN` | `liveTailPool: null`: the bus never listens, never says it crosses processes; open views keep the once-a-second read. Its writes still send notices. | `vz/store.ts:12-15,124-126` |
| Extra | Returns `scheduleIndex` on the same pool; a no-op until the pool resolves. | `vz/store.ts:43-60,131-137` |

## 3. Tenants

| Fact | Detail | Source |
|---|---|---|
| Isolation | A tenant id (the `x-tenant-id` header by default) namespaces sessions only. Session record key and the session-scoped resource scope id are `${tenantId}:${sessionId}`, bare `sessionId` when there is no tenant (an empty tenant counts as none). | `sk:229-250`; `packages/engine/test/user-cell-keys.test.ts:90-95` `[T]` |
| Requests | The record keeps the bare `sessionId` and a separate `tenantId`; listings filter on `tenantId`. | `ty:146-157` |
| Not split by tenant | User records, org records, and their resources. The user cell key and the org key contain no tenant. | `sk:177-227`; `user-cell-keys.test.ts:34-95` `[T]` |
| Filter semantics | `tenantId` (and `orgId`) in list options: key present, even `undefined`, means exact match and `undefined` matches only records with no tenant; key absent means no filter. | `ty:458-476,539-559`, `sk:313-351` |
| Bus topics | Every topic carries `tenantId`, `""` for none. | `packages/engine/src/bus/types.ts:20-31` |
| Wake key | Includes the tenant. | `ty:1835-1847` |
| Existing databases | SQLite and Postgres have a nullable `tenant_id` column; rows without read back as no tenant. | `sqs:14-26,79-92` |

## 4. Who owns a record, and what keys it

| Record | Storage key (the primary key) | Owner fields on the record | Source |
|---|---|---|---|
| Session | `<sessionId>`, or `<tenantId>:<sessionId>` with a tenant. Nothing else (not user, not flow) is in the key. | `flowKind`, `flowId`, `userId`, `orgId`, `tenantId` | `sk:243-250`, `ty:35-70` |
| Request | The request id. A caller-supplied id is rewritten per principal to `req_<32 hex>` from (tenant, org, user, supplied id) when another principal holds it. | `flowKind`, `flowId`, `userId`, `sessionId`, `orgId`, `tenantId`. | `context/request-principal.ts:56-95` [impl], `ty:140-157`. |
| User record | `<user>:~org:<org>`; `<user>:~org:<org>:<flow id>` when the flow sets `isolateUserState`. Each part escaped. | `userId` | `sk:169-200`; `user-cell-keys.test.ts:34-52` `[T]` |
| Org record | `<org>`; `<org>:<flow id>` when the flow sets `isolateOrgState`. | `orgId`, optional `userId` | `sk:215-227`; `user-cell-keys.test.ts:79-88` `[T]` |
| Resource state / content, session scope | `(session, <session storage key>, <resource key>)`. | n/a | `sr:529-545` |
| Resource state / content, user scope | `(user, <user cell key>, <resource key>)`: shared cell `<user>:~org:<org>`, or `<user>:~org:<org>:<flow id>` when the resource has `flowIsolation: true` (or the flow isolates user state and the resource says nothing). | n/a | `sk:403-432`; `user-cell-keys.test.ts:40-65` `[T]` |
| Resource state / content, org scope | `(org, <org>, <resource key>)`, or `<org>:<flow id>` when isolated. | n/a | `sk:415-432`; `user-cell-keys.test.ts:80-88` `[T]` |
| Resource state / content, lineage | `(lineage, <lineage id>, <resource key>)`: a session resource declared `sharedToLineage`. `lineageId` is minted once when a root session is created and inherited by its children. | `lineageId` on the session | `ty:94-100,1235-1254` |
| Checkpoint | `(requestId, blockInstanceId)`. | request | `ty:1692-1722` |
| Suspension | `(requestId, suspensionId)`. | `userId`, `flowId`, `sessionId` | `core/suspension.ts:44-60` |
| Lease | `requestId`. | none | `ty:1808-1833` |
| Wake | `(tenantId, sessionId, entry)`. | `flowKind`, `userId`, `orgId` | `ty:1835-1878` |
| Active request | `requestId`. | `flowKind`, `flowId`, `userId`, `sessionId`, `orgId`, `tenantId` | `ty:1146-1189` |
| Schedule index row | `(cell, key)`. | `user_id`, `org_id` | `sqs:531-541` |

Details the page may state:

- **Key escaping.** In user and org keys `\` and `:` inside an id are backslash-escaped; an id with neither
  keys as itself. Two different (user, flow) pairs can never produce one key. `sk:130-167`, `user-cell-keys.test.ts:129-170` `[T]`.
- **A missing org throws.** Building a user key with a missing, blank or malformed org throws `OrgRequiredError`
  (never defaults). A valid org id is a non-empty, non-whitespace string with no lone surrogate. `sk:169-181`;
  `core/auth.ts:49-66`; `user-cell-keys.test.ts:97-116` `[T]`.
- **One user, two orgs, two cells.** The same user id in `acme` and in `globex` reads and writes different user
  records and user-scoped resources. `user-cell-keys.test.ts:47-52` `[T]`. (Carries the "Alice in acme and globex" model.)
- **Session binding.** A session is created with the principal's `userId` and `orgId`, never the body's
  (`body.userId` is used only when no principal exists). The org is bound for the session's life; running it under
  another org throws `OrgBindingMismatchError`. `flowId` is the instance addressed. `sr:399-460`; `context/createExecutionContext.ts:1066-1076` [impl].
- **No sign-in, default org.** An app with no `resolvePrincipal` runs under the reserved org `DEFAULT_ORG_ID`
  (`"__fsd_default_org__"`, from `@flow-state-dev/core`). A resolver that returns it, returns no org, or an
  invalid one is refused. Local tools act as user `devuser` (`DEFAULT_LOCAL_USER_ID`). `core/auth.ts:20-48,120-135`; `sr:445-452`.
- **Another user's request.** A request owned by another user, tenant or (when the record carries one)
  organization answers `404`, the same as a missing one; abort, resume, retry, answer and status all ask first.
  `ru:191-213`, `context/request-principal.ts:41-54`.
- **Request ids.** The `requests` primary key is the bare id, not tenant-scoped; the id a principal supplies maps
  to `req_<hash>` per principal so two callers reusing one id never meet. `context/request-principal.ts:56-95` [impl].
- **Which flow.** Session and request list filter `flowKind` (definition, not ownership) and `flowId` (exact
  instance; a record with no `flowId` never matches). `ty:448-456,525-530`.
- **Unattributed records.** A session or request with no `orgId`, or (for a collection flow) no `flowId`, is
  preserved and refused: `409 { "error": "migration-required" }` on an addressed route, resume or retry for an
  authenticated caller; `401` for a caller the resolver could not identify; ordinary listings omit the row; recovery
  sweeps and scheduler skip it. `ru:716-767`, `sr:280-330`, `context/org-attribution.ts:60-70`,
  `packages/engine/test/org-boundary-routes.test.ts`, `flow-instance-ownership.test.ts`, `record-owner.test.ts` `[T]`
  (file names only, not read line by line: pass 5 should read them).

## 5. Which records carry an organization

| Record | Column / field | Required? | Source |
|---|---|---|---|
| Session | `orgId`; column `org_id` (nullable; legacy rows have none) | Stamped on every new record | `ty:35-52`, `sqs:14-26`, `pgs:9-21` |
| Request | `orgId`; `org_id` | Stamped | `ty:140-147`, `sqs:79-92` |
| Active-request entry | `orgId`; `org_id` | Stamped | `ty:1146-1155`, `sqs:146-160` |
| Wake | `orgId`; `org_id TEXT NOT NULL` | Required | `ty:1849-1857`, `sqs:583-596`, `pgs:677-690` |
| Schedule-index row | `org_id` (nullable; a row with none is quarantined, not dispatched) | Stamped from the writing run | `sqs:531-541`, `pgs:554-565`, `packages/scheduled/src/scheduleIndex.ts:52` |
| Org record | `orgId` is the record key | n/a | `ty:428-432`, `sk:215-227` |
| User record | Org is part of the key `<user>:~org:<org>` | Required (throws) | `sk:169-200` |
| User- and org-scoped resource state and content | Org is part of the `scope_id` | Required | `sk:403-432` |
| Session-scoped resources | None of their own; they follow the session | n/a | `sr:529-545` |
| Suspension, checkpoint, lease, runOnce, items, events, traces | **No org column.** Reached through the request. | n/a | `core/suspension.ts:44-110`, `core/checkpoints.ts:13-39`, `sqs:469-583` |

The reserved default org id cannot be a real org id: a configured resolver returning it is refused. `core/auth.ts:20-48,120-135`.
Org-attribution moves for existing data (the offline backfill of `org_id` and `flow_id`) are an Upgrading-page
subject; see section 17.

## 6. List and lookup contracts (what a store must filter in its query)

| Option | Contract | Source |
|---|---|---|
| `SessionListOptions.parentage` | Omitted or `"top-level"`: only sessions with no parent. `"all"`: every session. `{ parentOf: id }`: that session's children. A `null` parent counts as none. Absence **narrows**, where an absent `tenantId` or `orgId` widens. | `ty:446,478-492`, `sk:353-378` |
| `SessionListOptions.state` | Exact match on top-level state fields (string values); the route admits only `.readonly()` fields of the addressed flow. A store filters in its query, never after. | `ty:493-500` |
| `SessionListOptions.orderBy` | `"updatedAt"` (default) or `"createdAt"` (`(createdAt, id)`, both immutable, so paging does not skip or repeat on a written row). | `ty:501-522`, `stores/list-order.ts:28-52` |
| `RequestListOptions.sessionId` | One id (equality) or an array (set membership; empty matches nothing). | `ty:526-536` |
| `RequestListOptions.status` | One status or an array (set membership; empty array matches nothing, it is not "no filter"). | `ty:560-569` |
| `RequestListOptions.orderBy` | `"updatedAt"` (default), `"startedAtMs"` (`(startedAtMs, id)`), `"none"` (unordered; an existence check with `limit: 1` stops at the first match). | `ty:573-592`, `stores/list-order.ts:53-80` |
| `RequestListOptions.withItems` | Default false: SQLite and Postgres leave `items` off unless `withItems: true`. In-memory and filesystem keep items inline and return them from `list()` whatever the flag (the interface: adapters that store items inline ignore it). | `ty:593-599`, `sqq:643-650`, `packages/store-postgres/src/request-store.ts:607`, `packages/engine/src/stores/memory/request-store.ts:325-367`, `frs:523-527` |
| `limit`, `offset` | On every list. | `ty:521-522,570-571` |

## 7. What a custom store must guarantee

A custom store is a `StoreAdapter` whose `resolve()` returns a (partial) `StoreRegistry`; members it leaves out
come from in-memory. The contract is the doc comments on the interfaces in `ty`, and the conformance suites in
`@flow-state-dev/engine/testing` that the built-in stores run.

### 7.1 Registry members

| Member | Required? | Source |
|---|---|---|
| `session`, `request`, `user`, `org`, `activeRequests`, `content`, `resourceState`, `checkpoints`, `traces`, `suspensions`, `leases` | Required in a registry you build | `ty:1906-1917` |
| `wakes` | Optional. Without it the host logs once at start (`[flow-state] this host keeps no wakes: debts are paid on their fast paths only`) and a board's notices go out once, at the end of the task, and a lost one is not sent again. | `ty:1918-1923`, `ty:1835-1904` |
| `bus` | Optional. Filled with an in-memory bus when absent. | `ty:1924-1932`, `packages/engine/src/bus/publish-writes.ts:130` |
| `blobs` | Optional on a registry you build. Without it the upload and read routes answer `attachments_not_configured`. | `ty:1933-1940` |
| `checkpoints.persists`, `suspensions.persists` | `false` only when the store keeps nothing past the process. Absent means it persists. Decides durable execution's default. | `ty:1704-1707,1762-1764`, `durability/default-durability.ts:29-31` |

### 7.2 Atomicity (the lookup "What must a custom store do atomically?")

| Operation | Must be one atomic step | Source |
|---|---|---|
| Scope `set(id, value, expectedVersion)` | Compare the stored version and write. `"any"` always writes; a number writes when the stored version equals it (`0` means "stored at version 0", a live record); `"absent"` writes when no record exists at any version (the create-if-absent). On conflict, return `{ ok: false, conflict: { currentValue, currentVersion } }`, never throw. | `ty:613-671,758-791`; `lt/scope-store-conformance.ts:149-225` `[T]` |
| Two concurrent creates at `"absent"` | Exactly one wins; the loser gets the winner's record. Session create returns `201` to one, `409` to the other. | `lt/scope-store-conformance.ts:202`, `:444-462` `[T]`; `sr:484-512` |
| Delta verbs `patchField`, `incField`, `pushToArray`, `deleteField` (optional) | Same version predicate as `set`; touch only `state`; write the caller's `updatedAt`. `incField` treats missing or `null` as 0 and throws on a non-number; `pushToArray` treats missing as `[]` and throws on a non-array (including `null`); `"absent"` throws. A store without a verb gets a version-checked whole-record `set` for that write instead. | `ty:674-756`; `lt/scope-store-conformance.ts:267-440` `[T]`; `stores/scope-persist.ts:130-211` [impl] |
| `RequestStore.setFieldsIfStatus(id, fields, allowedStatuses, updatedAt, expectedIncarnation?)` | Check the status (and incarnation) and write. Returns `{ applied, status }`; absent record: `{ applied: false, status: undefined }`; empty `allowedStatuses` matches nothing; a different incarnation reports as absent, with nothing written. The incarnation is a random id (`inc_<uuid>`) stamped on the record when it is created; a request id can be used again once its record is deleted, and the new record gets a new one, so a caller holding a different incarnation is addressing an earlier record with that id. `fields` may move `status` with its `result`. Writes the abort flag, which `set` ignores in both directions. | `ty:160-177,949-1005,244-261,390-421`, `packages/engine/src/context/initial-request-record.ts:65-84`, `sk:564-569`; `lt/request-store-conformance.ts:851-1400` `[T]` |
| `RequestStore.deleteIfStatus(id, allowedStatuses)` | Check the status and delete the record, items, events and runOnce results. Wait for in-flight writes for the id; do not drop them first (they belong to a run still going). | `ty:844-862`; `lt/request-store-conformance.ts:742-795` `[T]` |
| `RequestStore.delete(id)` | Remove everything under the id (items, events, runOnce results) before the record; the record last, after every child delete has succeeded; drop writes still queued for the id. | `ty:832-843`; `lt/request-store-conformance.ts:670-740` `[T]` |
| A `set` that settles a request | Land the items it carries in the same write as its status. A `set` that leaves `items` off keeps the stored items. | `ty:808-826`; `lt/request-store-conformance.ts:539-568` `[T]` |
| Resource-state `set` / `delete` | Compare the live version and write together. First create writes `1`; each commit +1; versions never reused; `0` is create-if-absent (a tombstone satisfies it); `"absent"` is refused by a tombstone. Snapshot the caller's value **before** yielding. Index entries commit with the row or not at all. | `ty:1451-1560`; `lt/resource-store-conformance.ts:508-540,564-690` `[T]` |
| Lease `acquire` | One active lease per request: concurrent first acquires from different holders grant exactly one; an expired lease can be taken over; a stale holder's release does not free a newer holder's lease. | `ty:1808-1833`; `lt/lease-store-conformance.ts:52-116` `[T]` |
| Wake `owe`, `move`, `clear` | `owe` coalesces under one key (earlier `dueAt`, later `landBy`, version +1); `move` and `clear` apply only at the version read, so a wake written during a pass survives it. | `ty:1866-1904`; `lt/wake-store-conformance.ts:59-154` `[T]` |
| Resource index `completeBuild` | Add entries and mark `built` in one commit, only if the `building` marker it began is still there. A `set` makes the key's entries exactly the ones it lists, in the row's commit. | `ty:1377-1447` |
| `listPendingForUser` | One query joining each suspension to its request, not a read then a filter. | `ty:1781-1805` |

### 7.3 Other obligations

| Member | Obligation | Source |
|---|---|---|
| `RequestStore.persistItems(requestId, items)` | Union by item `id`, last write wins; existing items keep position, new ids append; re-persisting an id whose content changed writes the latest content (the runtime mutates one item object in place). Persisted items readable before the request settles. | `ty:864-888`; `lt/request-store-conformance.ts:471-615` `[T]` |
| `RequestStore.flushItems`, `flushEvents` | Resolve when pending writes landed; a failed write rejects. | `ty:891-896,1014-1018`, `frs:561-575,609-625` |
| `RequestStore.countItems(requestId)` | Required. Count without loading payloads; `0` for an unknown request. | `ty:915-925`; `lt/request-store-conformance.ts:616-668` `[T]` |
| `RequestStore.isAbortRequested(requestId)` | Required, a primary-key lookup, O(1) in item count (it runs on the heartbeat tick for the life of every request). `false` for an unknown request. | `ty:927-947`; `lt/request-store-conformance.ts:851-965` `[T]` |
| `RequestStore.set` and the abort flag | Never honours `abortRequested` from a full record: the stored value survives a record that omits it and a record that carries it cannot set one. | `ty:796-807`; `lt/request-store-conformance.ts:1353-1400` `[T]` |
| `RequestStore.getEvents(requestId, fromSequence?)` | Events with `sequence_number > fromSequence`, sorted; no argument returns the whole log. | `ty:1020-1027`; `lt/request-store-conformance.ts:419-440` `[T]` |
| `RequestStore.subscribeToEvents(requestId, options)` | Catch-up for `sequence_number > fromSequence`, then live, no duplicates across the boundary; ends on `signal.abort`, on a terminal event (`completed`, `failed`, `incomplete`, `aborted`, `suspended`, `interrupted`), or after `livenessTimeoutMs` (default 30000) of silence with a synthetic `request.interrupted`; `followThroughSuspend` keeps going past `request.suspended`; overflow of `maxPendingEvents` (default 1000) throws `StoreSubscriptionError("backpressure_overflow")`. Call `options.isStillAuthorized` after every read that returned events, before yielding any, and end without yielding when it resolves `false` or throws. SQLite, filesystem and Postgres without `liveTailPool` poll until abort, a terminal event, or `livenessTimeoutMs`; in-memory stays live through an in-process bus. No built-in store ends after the catch-up. | `ty:1029-1043,1072-1120`; `lt/request-store-conformance.ts:124-470` `[T]`; `stores/subscribe-helpers.ts:1-50,150-159` |
| `getRunOnceResult`, `setRunOnceResult` | `{ found, value }`; `set` replaces any prior value for `(requestId, key)`; misses cheap. Removed when the request is deleted; deleting `r` leaves the results of an id that merely starts with `r`. | `ty:1044-1069`; `lt/request-store-conformance.ts:670-740` `[T]` |
| `RequestRecord` fields to persist | `finalizedAtMs` (`null` means "not finished", absent means "unknown"; tell them apart with `=== null`), `heartbeatsUntilFinalized`, `incarnation` (the id defined in the `setFieldsIfStatus` row: stamped once when the record is created, carried unchanged), `result`, `spentByModel`, `spentThroughItemIndex`, `spentHarnessRuns`, `source` (reads of old records default to `"http"`), `attachments`, `historyStart`. | `ty:162-306` |
| `SessionRecord` fields to persist | `flowId`, `parentSessionId`, `lineageId`, `topic`, `coordinate` (an unset field may read back `null` from a store that nulls absent keys: guard `== null`). | `ty:35-138` |
| Filters | Honour `tenantId` and `orgId` as present-vs-absent exact match, NULL-safe; `parentage` as above; `flowId` exact and never matching a record with none. | section 6 |
| Request-record deletion by retention | Retention (session `retention: { maxItems, maxAge }`) deletes whole past requests, only once `finalizedAtMs` is set, through `deleteIfStatus`. | `core/flow.ts:342-352`, `ty:200-223` |
| `ContentStore` | `get`, `set` (create or overwrite, **last write wins**), `delete`, `getAll`, `getByPrefix` (an empty prefix returns all; wildcards literal), `deleteAll`. Keyed `(scopeType, scopeId, resourceKey)`. | `ty:1256-1287`; `lt/resource-store-conformance.ts:60-165` `[T]` |
| `ResourceStateStore` | Reads return live rows only (a tombstone reads as absent); `delete` keeps the version and drops the payload; `deleteAll` tombstones the scope; `purgeTombstones` is the only reclaim, called when a session is re-created under a reused id. Numeric `expectedVersion` must be a non-negative integer (anything else throws `TypeError`, never a conflict). Legacy unversioned rows read as live at version 1. Every state crossing the boundary is a deep copy. | `ty:1483-1497,1520-1681`; `lt/resource-store-conformance.ts:235-1150` `[T]` |
| `ResourceStateStore.indexes` | All four verbs (`state`, `beginBuild`, `completeBuild`, `findKeys`) or none; without them lookups scan. | `ty:1377-1403,1683-1688`; `lt/resource-store-conformance.ts:1152-1460`, `lt/find-by-conformance.ts` `[T]` |
| `CheckpointStore` | Latest-only per `(requestId, blockInstanceId)`; `delete` at sequencer end; `deleteForRequest` idempotent. | `ty:1692-1722` |
| `SuspensionStore` | `set`, `get`, `list`, `deleteForRequest`, `pruneTerminalBefore(cutoff, limit)` (never touches pending; returns rows deleted), `listPendingForUser`. | `ty:1757-1806`; `lt/pending-user-suspensions-conformance.ts:151-290` `[T]` |
| `TraceStore` | `appendEvent`, `flush`, `getEvents(requestId, fromSequence?)` (exclusive lower bound), `listRequestIds` (insertion order); bounded retention is the store's job. | `ty:1738-1755`; `lt/trace-store-conformance.ts:78-160` `[T]` |
| `ActiveRequestRegistry` | `register`, `heartbeat`, `deregister`, `listStale(thresholdMs)`, `listAll`, `get`; declare `sharedAcrossProcesses`: absent means NOT shared. | `ty:1191-1227` |
| Change bus | See section 11. | |

Conformance harnesses, all from `@flow-state-dev/engine/testing`: `createScopeStoreConformanceTests`,
`createRequestStoreConformanceTests`, `createRequestRetentionConformanceTests`, `createContentStoreConformanceTests`,
`createResourceStateStoreConformanceTests`, `createFindByConformanceTests`, `createLeaseStoreConformanceTests`,
`createPendingUserSuspensionsConformanceTests`, `createWakeStoreConformanceTests`, `createTraceStoreConformanceTests`,
`createSessionStreamConformanceTests`, `createParkedGateConformanceTests`, plus `gateNextStateRead`. `et:6-62`.
The scope-store harness runs against the in-memory and filesystem session stores
(`packages/engine/test/scope-store-conformance.test.ts:30-45`), and SQLite and Postgres have their own
(`packages/store-sqlite/test/scope-store-conformance.test.ts:24`, `packages/store-postgres/test/scope-store-conformance.test.ts:32`).

Not in the contract file: the interfaces say "the exact interface may evolve; check the package source" (`ov:356`).
The page should point at the type names, not freeze member lists.

## 8. Concurrency and process sharing, per store

| Store | Scope-state and resource-state writes | Several processes on one store | Source |
|---|---|---|---|
| In-memory | Atomic in the store | Each process has its own data | `mem/*`, `ty:1509-1514` |
| Filesystem | Per-record and per-key lock **on the store instance** | Not supported: no inter-process locking; two instances over one directory race, in one process or two (both create-if-absent calls can succeed, and a record can overwrite another) | `frs:148-154`, `fs/resource-state-store.ts:26-33`, `ty:1509-1514` |
| SQLite | Atomic (a transaction per write; the status-predicate writes use `BEGIN IMMEDIATE`) | One writer at a time (second waits up to 5000 ms, then `SQLITE_BUSY`); readers run beside it; `sharedAcrossProcesses: false`; does not back `bus` | `sqq:550-565`, section 2.2 |
| Postgres | Atomic in the store; schema init under an advisory lock | Every connection to the database; `sharedAcrossProcesses: true` for `connectionString` and `{ pool }`; backs `bus` | `ty:1509-1514`, `pgr:91-100,259` |

- **Concurrent writes to one scope-state field combine only for increments and appends.** `incField` and
  `pushToArray` apply to the value the store currently holds (up to 4 attempts to re-apply), so concurrent
  increments and appends both land on a built-in store. A write to one field with `patchField` replaces. A custom
  store without a verb falls back to a whole-record write at the expected version, and one of two concurrent
  writers is refused. `stores/scope-persist.ts:38,130-211` [impl]; `ov:84` (page); the State Operations page owns
  which calls take which path.
- **Field delete.** Filesystem session, user and org stores have no `deleteField`; no store has it on the request
  record. Where the verb is absent a delete writes the whole record at the expected version, once. `fs/session-store.ts:91-123`,
  `sq/request-store.ts:592-594`, `pg/request-store.ts:519-521`, `scope-persist.ts:194-211`. The page-stated result,
  "lose the race and the call returns `false` with the key still stored" (`ov:99`), is on the State Operations
  page's side; not re-verified here.
- **Resource deletes leave a row.** `delete` marks the row `deleted`, keeps the version, stores `{}`. Nothing ages
  a tombstone out: no sweep, TTL or retention window, so create-and-delete of many keys accumulates one row per
  deleted key. Reclaimed in one place: when a session record is created under an id, the runtime clears that id's
  tombstones first (so a reused session id gives writable resources); the reclaimed key's version restarts at `1`.
  `ty:1493-1506,1626-1681`, `sr:` the birth path (`birthSession`) [impl], `store-sqlite/README.md` ("deletes leave a row behind").
- **A session id is the key.** Nothing else is in a session's key, so within one tenant two users deriving one id
  collide: the key is `resolveSessionStorageKey(sessionId, tenantId)`, with no user, org or flow. The first create gets
  `201`, every later one `409` `{ error: 'Session "<id>" already exists' }`, whoever sends it. Reading the id as the
  other user returns the first record with no authentication (the default resolver checks no owner), and `404`
  `{ error: 'Unknown session "<id>"' }` with authentication on, the same answer as an unused id; `403` is given only
  for an organization mismatch, never for another user's session. Derive ids from everything that tells sessions
  apart (user, org, flow, ticket). `sk:243-250`, `sr:420-512`, `packages/engine/src/routes/route-auth.ts:120-126,245-246,612-623,643-676`,
  `packages/engine/src/routes/route-utils.ts:118-120`; `packages/engine/test/session-create-race.test.ts:60-95`,
  `packages/integration-tests/src/two-users-one-tenant/session-id.test.ts:120-160` `[T]`; `ov:393`.
- **The page's example id.** `["support-desk", orgId, userId, ticketId].map(encodeURIComponent).join("|")`:
  `encodeURIComponent` escapes `|`, so distinct triples give distinct ids. The create route puts no character rule
  on a session id beyond the reserved write-session ids (`sr:420-426`). `identity()` on a flow handle returns
  `{ userId, orgId }` (`packages/client/src/client.ts:446-451,906`).

## 9. Session lookup by metadata

What a session carries to be looked up by, and what the server filters.

| Fact | Detail | Source |
|---|---|---|
| Fields set at create | `sessionId`, `title`, `description`, `tags`, `metadata` (free-form object), `state`. | `cl` `CreateSessionOptions` (`client.ts:150-157`), `sr:381-515` |
| Reserved ids | A write-session id is the server's: a create at one answers `400 reserved-session-id`. | `sr:421-427` |
| Editing | `sessions.updateMetadata(sessionId, { title, description, tags, metadata })`. `title`, `description`, `tags` replace; `metadata` shallow-merges into the stored metadata. Written at the version read; retried on a lost race; `409` "kept changing" when it keeps losing. | `cl:469-480` `clt` `UpdateSessionMetadataOptions` (`client.ts:159-165`), `sr:548-611` |
| Server-side listing filters | `GET /api/flows/sessions?flowKind=&flowId=&userId=&limit=&offset=&include=&state.<field>=`. `ListSessionsOptions`: `flowKind`, `flowId`, `userId`, `limit`, `offset`, `include` (`"dispatch-runs"`, `"status"`), `state`. | `cl:86-113`, `sr:176-290`, `packages/client/test/sessions.test.ts:107-113` `[T]` |
| No metadata filter | There is no `metadata` filter on the route, the client, or `SessionListOptions`. A caller lists and filters `metadata` in memory. | `ty:448-523`, `cl:86-113` |
| **The server-side lookup that exists: readonly state** | Declare the key as a `.readonly()` field of the session `stateSchema` (`z.object({ ticker: z.string().readonly() })`). It is set at create (`createSession({ state: { ticker } })`) and cannot change. `sessions.list({ flowKind, state: { ticker } })` filters in the store's query. Needs `flowKind` or `flowId`; a field that is not readonly on that flow, or a filter with no flow, is refused `400` with the reason, not ignored. Readonly fields are also the only state a client can read back. They are read from a top-level `z.object`, also through `.optional()`, `.nullable()`, `.default()`, `.readonly()` and refinement wrappers; a union, intersection or lazy schema yields none. | `core/flow.ts:360-368`, `packages/engine/src/context/readonly-state-filter.ts:1-50`, `sr:182-211`, `ty:493-500`, `routes/client-session.ts:1-12`; `packages/engine/test/session-birth.test.ts:103-110,195-244` `[T]`, `packages/core/src/helpers/zod-introspect.ts:82-101` |
| Existing page says otherwise | `ov:385` says server-side metadata filtering is "not yet available" and the client filters in memory. True for `metadata`. It omits the readonly-state filter, which is the lookup path (the Workforce `ensureWorkerSession` uses it, below). | `ov:385` vs `sr:182-211` |
| Derived id as the key | `createSession({ sessionId })` with an id built from the lookup components. Create-if-absent: `409` when it exists, exactly one of two concurrent creates gets `201`. | `sr:484-512`; `lt/scope-store-conformance.ts:202` `[T]` |
| In-repo precedent | `ensureWorkerSession`: one session per (user, organization, flow, criteria) at a derived id (SHA-256), the criteria stored as readonly session-state fields (`workerId`, `filingSessionId`, `workstreamId`, `projectId`, `taskId`). A racing second call ends on the same session by reading the winner back from its `409`. A create at an id carrying the derived prefix is refused unless it is the creating user's own derivation. | `packages/workforce/src/workers/derive-session-id.ts:1-95` |
| Filesystem caveat | Create-if-absent holds among writes through one store instance; a second filesystem store on the same directory can let both creates succeed. In-memory: two stores are two datasets. | `fsh:311-342`; section 8 |
| Listing scope | An authenticated caller sees only their own sessions (principal's user and org, overriding the `userId` query); an unauthenticated app filters by the `userId` param. A listing omits unattributed rows. Another org's rows never appear. | `sr:213-330` |
| Listing returns | Sessions newest-updated first. `parentage` is `"top-level"` unless `include: "dispatch-runs"`. | `ty:520`, `cl:96-108`, `sr:239-258` |

## 10. Cost per request

Each row is observable from the schema, the adapter's doc comment, or a test.

| What | Cost | Source |
|---|---|---|
| Items, SQLite and Postgres | One row per item in `request_items`, upserted by `(request_id, item_id)`. Only items whose serialized content changed since the last write are written; a block's `block_trace` item (status `in_progress`, `completed`, `failed` or `planned`) keeps one row in `request_items`, rewritten when its status moves from `in_progress` to `completed` and skipped by writes where its serialized content did not change. The adapter keeps per-request memory of what it wrote until the request's run ends (`releaseItemTracking`). | `sqq:1-15,222-262,249-253,384-401`, `pg/request-store.ts:316-330`, `ty:898-913`, `packages/contracts/src/items/types.ts:223-228` |
| Items, filesystem and in-memory | Items live inline on the request record. Every item write is read-merge-write of the whole record, so cost grows with items; `countItems` reads the record. | `frs:140-147,529-560,575-579`, `mem/request-store.ts:70,175-186` |
| Settling write | Lands the final items and the status together. | `ty:808-826` |
| Events, SQLite and Postgres | One row per event (`request_events`). | `sqs:389-397`, `pgs:496-504` |
| Events, filesystem | Append of only the new events, to one NDJSON file per request. | `frs:135-139,581-607` |
| `list()` | SQLite and Postgres do not read items unless `withItems: true`; filesystem and in-memory return the inline items either way. | `ty:593-599`, `sqq:643-650`, `packages/store-postgres/src/request-store.ts:607`, `packages/engine/src/stores/memory/request-store.ts:325-367`, `frs:523-527` |
| `countItems` | Indexed `COUNT` on `request_items` (SQLite, Postgres); a record read on filesystem. Used by retention's `maxItems`. | `ty:915-925`, `sqq:280-282,690`, `frs:575-579` |
| Abort check | `isAbortRequested`: one primary-key read per heartbeat tick per running request; on filesystem a `stat` of the `.abort` marker. | `ty:927-947`, `frs:56-73,326-335` |
| Heartbeat | `request.heartbeatIntervalMs`, default 10000, `0` disables. Each tick costs one store read per running request; the same tick delivers a cancel recorded elsewhere and keeps the registry entry warm, so `0` disables both and a run can be marked `interrupted` while still running. | `core/flow.ts:424-433`, `apps/docs/docs/server/connection-resilience.md:132-141` |
| Checkpoint | Latest only: one row per (request, sequencer instance), overwritten at each step boundary and each pause; deleted when the sequencer ends. Constant however many steps. | `ty:1692-1722`; `core/checkpoints.ts:1-12` |
| runOnce | One row (file) per distinct key per request. | `sqs:502-509`, `frs:84-97` |
| An open session view (`GET /sessions/:id/stream`) | Reads the store only after a change notice on a bus that crosses processes (at most once a second), and once a second on a bus that does not. A view of a quiet session costs nothing on a crossing bus. Each read costs what is running now, never the session's whole history: unfinished requests plus requests updated since a floor a few seconds behind the last read. The server closes a connection after 15 minutes and pings after 15 seconds of silence. | `ss:1-60,108-124,405-430`; `packages/engine/src/stores/testing/session-stream-conformance.ts:1120-1330` `[T]`; table in section 11 |
| Client timer | A client subscription with `pollIntervalMs` reads on a timer wherever push can miss: no push, the socket down, a bus that does not cross. `client.live` defaults to 3 s (`null` for none). | `client/src/subscribe/push-hub.ts:15-22`, `client/src/live/live-read.ts:38,66-72,113` |
| Traces | Bounded per request count; section 12. | |
| Tombstones | One small row per deleted resource key, never reclaimed (section 8). | `ty:1493-1506` |
| Schema init | SQLite: DDL on open unless `skipSchemaInit`. Postgres: on every create unless `skipSchemaInit`; the Vercel adapter skips it. | section 2 |
| Existing cost page | `apps/docs/docs/server/setup.md:99-101` ("Persistence cost model"): says the filesystem store "appends event lines to an NDJSON file" and calls items incremental on "all backed adapters". Items are not appended on the filesystem store; see **Contradictions**. | `setup.md:101` vs `frs:140-147` |

## 11. The change bus

| Fact | Detail | Source |
|---|---|---|
| What it is | A notice that something under a topic changed, published once the change can be read; never carries rows; at most once. | `packages/engine/src/bus/types.ts:1-30` |
| Who publishes | Every request and session write that lands; the engine wraps the request and session stores of a registry so each write publishes. A write that did not land (a version conflict, a failed status predicate) publishes nothing, and `persistEvents` does not publish. | `ty:1924-1932`, `bus/publish-writes.ts:1-65,130`, `ov:342` |
| Topic | `{ scope, id, tenantId, resource? }`; `tenantId` always present (`""` for none). A subscriber to a scope hears every notice under it; one narrowed to a resource hears only that resource's. | `bus/types.ts:32-66` |
| Members | `publish(notice)` (a failure must not fail the write), `subscribe(topic, listener)`, `crossesProcesses`, `onCrossingChange(listener)`. | `bus/types.ts:68-111` |
| `crossesProcesses` | `true` only while a change in any process serving the app reaches this one. While true, the session stream stops its timed read and clients stop their fallback polls, so a wrong `true` is a view that stops updating. A change to `false` puts waiting views back on the timed read. | `bus/types.ts:1-30,86-111` |
| Reconnect | A bus that lost its connection and got it back sends each subscriber one `resync` notice. | `bus/types.ts:62-66` |
| In-memory bus | Default, and what every SQLite, filesystem and in-memory profile gets (none declares `bus`). `crossesProcesses` always `true`, even when another process writes the same SQLite file: for an app that runs as one process. `createInMemoryBus()` (from `@flow-state-dev/engine/host`) lets an adapter fan in-process. | `bus/in-memory-bus.ts:31-45`, `eh:90` |
| Postgres bus | One `LISTEN` connection per process, taken from the tail pool by the first subscriber and handed back by the last. A process with no open view (a worker, `fsdev run`) publishes and holds none. Pings itself every 2 s; says it crosses while it hears its own ping; unheard for 3 s, or connection lost: says it does not, views go back to the once-a-second read, it reconnects with backoff (100 ms to 30 s), sends `resync`, and says it crosses on the next ping heard. A payload of 8000 bytes or more (`MAX_PAYLOAD_BYTES = 7_999`) drops its ids and task-board partition first, then its `resource` narrowing, and goes out as the bare scope. A transaction-mode pooler accepts `LISTEN` and delivers nothing, hence the ping. | `pgb:1-52` |
| No tail pool, no crossing | `{ executor }` or `{ pool }` without `liveTailPool`, or `liveTailPool: null`: the Postgres bus never listens and never says it crosses. Writes notify for `{ pool }` (`vercelPostgresStores` is this case) and a connection string, with or without `liveTailPool: null`; `{ executor }` without a tail pool does not notify (`notify: !("executor" in options) \|\| (liveTailPool ?? null) !== null`). | `pgb:28-31,80-84,148`, `pgr:215-223`, `packages/vercel/src/store.ts:119-120` |
| What an open view reads | Crosses processes (the in-memory bus included): only after a change notice in its own process, at most once a second; a quiet session costs nothing. Does not cross (`false`, such as a Postgres bus with no tail pool or one that lost its ping): after a change and also about once a second. | `ss:1-30,414-489`; section 10 |
| Cases that miss a change | Each process on a SQLite file has its own in-memory bus, which says it crosses, so its views do no timed read: a write from another process reaches an open view only when a change in the view's own process wakes a read of that session, or on reconnect (server closes a session stream after 15 minutes). Cases: several servers on one SQLite file; `fsdev run` or `fsdev chat` writing the SQLite file a running `fsdev dev` reads. `fd:1-14` says pages "show it on their next read"; the next read is one of those two. | `fd:1-14`, `ss:111-115,414-489`, `bus/in-memory-bus.ts:36-42`, `ov:340` |
| Your own registry | If you pass a `StoreRegistry` you built, set `bus` on it to use your own; the engine otherwise fills an in-memory bus (`withChangeBus`). | `ty:1924-1932` |

## 12. Trace store

| Fact | Detail | Source |
|---|---|---|
| Record shape | `TraceEvent`: `{ requestId, sequenceNumber, ts, type: "trace.item.added" \| "trace.item.done", item }`, where `item` is a `block_trace`, `router_decision` or `state_snapshot` item. | `ty:1724-1736` |
| Backends | In-memory (default; and what the Postgres adapter uses), filesystem (`<rootDir>/traces/`: `_roster.json` plus one `<requestId>.ndjson` per request), SQLite (`trace_request_roster` and `trace_events`, events cascade-deleted with the roster row). | `si:187-212,248-253`, `fs/trace-store.ts:1-50`, `sq/trace-store.ts:1-30`, `pgr:236` |
| `maxRequests` | FIFO over distinct request ids: a new request over the cap evicts the oldest request's events. The registry factories (in-memory, filesystem, SQLite) default to 1000 when `NODE_ENV=development` and 50 otherwise; an explicit number wins. The Postgres adapter takes no option and uses the store's own default of 50. | `si:163-185`, `sqr:29-32,77-80`, `mem/trace-store.ts:1-35`, `pgr:236` |
| `maxBytesPerRequest` | In-memory store only: 5 MiB per request by default; appending past it drops that request's oldest events until the new one fits. | `mem/trace-store.ts:5-35,55-62` |
| Options reachable | `createInMemoryStores({ traceStore: { maxRequests, maxBytesPerRequest } })`; `filesystemStores({ traceStore: { maxRequests } })`; `sqliteStores({ traceStore: { maxRequests } })`. Filesystem ignores `maxBytesPerRequest`. | `si:131-134,136-146`, `sqr:34-47` |
| Failed write | Filesystem: an append failure rejects the `appendEvent` promise, calls `onPersistError({ store: "traces", id, error })` and logs "[flow-state] trace event persistence failed for <id>". A corrupted line is skipped on read with one warning per file. SQLite writes synchronously. | `ftr:95-165,192-205`, `sq/trace-store.ts:17-19` |
| Transient blocks | A block declared `transient: true` streams its `block_trace` live and the trace is not in the request record's persisted items; the action's `result` output is still stored. The request record never holds transient items, nor ephemeral content parts such as `output_audio`. | `ra:431-446`; `packages/engine/test/block-trace-lifecycle.test.ts:528-570` `[T]`; `apps/docs/docs/streaming/emitting-items.md:212` |

## 13. What a store keeps of a request

| Fact | Detail | Source |
|---|---|---|
| `result` | Saved with the final status. `completed` / `incomplete`: `{ output }` (`{}` when nothing was returned). `failed`: `{ error: { code, message } }`, plus `output` when the action answered before a completion hook failed it. `aborted`, `interrupted`, `suspended`: none. A record from before results were stored has none (guard `== null`). | `ty:262-341`, `clt:262-296` |
| JSON copy | `output` is stored as JSON: a `Date` becomes its ISO string, an object key whose value is `undefined` is left out. A value JSON cannot hold (`BigInt`, a cycle, `NaN`, `±Infinity`, a function or symbol, an `undefined` array slot, a `Map`, `Set`, `Error`, other built-in containers) is not stored: `outputNotRecorded: true`. The status still lands. | `ty:309-341` |
| Reading it | `sessions.requests(sessionId, { includeResultOutput: true })` (`include_result_output=true`) lists each finished request's `result.output`; without it `result` carries `hasOutput` and no `output`. The request status route takes the same flag. | `cl:118-128,633-640`, `clt:262-306`, `packages/engine/src/routes/request-status-routes.ts:40-72` |
| A failed request | The record gets `status: "failed"`, `failedAtMs`, `result.error`, and the items emitted so far plus an `error` item (`{ type: "error", status: "failed", message, code }`), the items written before the status. Persists on SQLite, Postgres, filesystem; lost with the in-memory store. | `ra:490-600` [impl: this is the setup-failure writer; the same record shape is the contract in `ty:313-341`]; `ty:327-341` |
| Items on the record | The session's item list is assembled from its request records on read, newest-updated first, one order across adapters. SQLite and Postgres `RequestStore.list()` does not return items unless `withItems`; in-memory and filesystem return them whatever the flag. | `ty:240,593-599`, `stores/list-order.ts:53-80` [impl for "assembled": `sr:615-660`] |
| History window | Cross-turn history loaded per request is bounded (`session.historyWindow: { turns }`, default 50 turns), and session `retention` (`maxItems`, `maxAge`) evicts whole old request records, lazily on write. | `core/flow.ts:342-352,376-389` |

## 14. Hosts that discard the disk, and process-shared deployments

These rows are existing-guide claims. Where the code or a run backs them it is cited; the rest is marked
**[guide]** so pass 5 does not take them as verified.

| Fact | Detail | Source |
|---|---|---|
| Serverless (Vercel, Lambda) | In-memory: lost on every cold start. Filesystem: writes succeed and the data is gone on the next invocation. SQLite: the file is as ephemeral as the disk. A network database (Postgres) keeps records between invocations. | **[guide]** `apps/docs/guides/deploying-to-vercel.md:98-108`, `apps/docs/guides/deploying-to-aws-lambda.md:19`; consistent with `si:215-263`, `sqr:59-88` |
| Container hosts (Railway, Docker) | Filesystem store: the container's disk; survives a process restart, lost when the container is rebuilt or migrated. SQLite on a mounted volume survives both. | **[guide]** `apps/docs/guides/deploying-to-railway.md:188-206`, `apps/docs/guides/deploying-with-docker.md:92,376` |
| Paths a volume must cover | Filesystem: `rootDir` (required; the Railway example passes `.flow-state-data`). SQLite: the `filename`'s folder. | `si:136-140`, `sqr:34-36`; **[guide]** `deploying-to-railway.md:306` |
| Replicas | Filesystem: not shared (each replica has its own disk; no cross-process locking). SQLite: one writer at a time with a 5000 ms wait (section 2.2); the registry declares itself not shared across processes. Postgres: shared. | `frs:148-154`, section 2.2, `pgr:91-100`; **[guide]** `deploying-to-railway.md:275-279` |
| Dispatch-only and worker-only processes (BullMQ) | Both `createFlowState` instances must point at the same durable backend; nothing compares them. Pointed at different stores, nothing fails: the worker's writes never reach the store the web tier reads, and the client sees a request in progress forever. Backends that can be shared across processes: Postgres. SQLite only between processes on one machine's disk, and its registry declares itself not shared. In-memory and filesystem cannot be. | `packages/bullmq/README.md:60-64`; `sqr:98`, `pgr:91-100`, `mem/active-request-registry.ts:12`, `fs/far:43` |
| Abort across processes | Needs a request store shared across processes: SQLite or Postgres. In-memory is per-process; the filesystem store assumes a single writer per request. | `apps/docs/docs/server/connection-resilience.md:136-141`, `frs:148-154` |
| Stale-sweep and interrupted marking | After a restart an in-flight request on a store that persists reads `interrupted` once its last heartbeat is stale and a sweep ran. On in-memory stores the registry and record die with the process, so nothing is left to mark. A suspended request is not touched. | `ty:1146-1227`, `si:187-212` |
| Postgres with several servers | A view open on one process sees a change saved on another as soon as it is saved (no config); a view of a quiet session costs the database nothing. | section 11 |
| `fsdev dev` / `fsdev run` | With no app config, both open `.fsdev/data/fsdev.db` (SQLite), shared. `--store filesystem` uses JSON files under `.fsdev/data`, single-process, so `run` and `dev` cannot share it. A command with an app config uses the app's stores and refuses `--store`. | `fd:1-14,28-33,70-86`; `packages/fsdev/src/commands/run.ts:149,265` |

## 15. Existing-docs claims about stores, checked

| Claim (page) | Verdict |
|---|---|
| Postgres "coming soon" (`apps/docs/guides/deployment.md:46-52`) | Wrong: `@flow-state-dev/store-postgres` ships (`store-postgres/package.json:2`). Drop. |
| "PostgreSQL or MongoDB store adapters (when available)" (`deploying-to-railway.md:279`) | Wrong for Postgres; no Mongo adapter in the package map. Drop. |
| `import { createSQLiteStores, sqliteStores } from "@flow-state-dev/store-sqlite"` (`store-sqlite/README.md:23`; Railway guide `createSQLiteStores`) | `createSQLiteStores` is on `@flow-state-dev/store-sqlite/host` (`store-sqlite/src/index.ts:1-12`). The root exports `sqliteStores`. |
| `createInMemoryBus`, `isBatchStillAuthorized`, `WakeStore` "from `@flow-state-dev/engine`" (`ov:285,308,338`) | They are on `@flow-state-dev/engine/host` (`eh:64,90,216-218`). The root exports neither (`ei:1-22`). |
| `blobs`, `queue`, `scheduler` slots exist and are no-ops (`ov:11`) | Only `primary`, `bus`, `blobs` exist, and `blobs` is real (section 1). |
| Filesystem "appends items and events to an append-only log" (`ov:346`, `setup.md:101`) | Events only. Items are inline on the record. |
| `.runonce.<key>.json` older layout read, `.quarantined` rename (`ov:58`) | No code for it: `quarantined` appears only in schedule-index code. Drop. |
| "SQLite ... `createSQLiteStores` ... `Don't use SQLite` with replicas" (`deploying-to-railway.md:277`) | Verified in part: one writer at a time with a 5 s wait then `SQLITE_BUSY` **[run]**. "Cannot share one file across replicas" is not verifiable in code. |
| Filesystem trace "O(N^2) event persistence" warning (`si:155-161,222-228`) | Event persistence appends only new events; the warning text is stale. Items are the O(items) cost. Do not repeat "O(N^2)". |

## 16. Rows moved to R-16 by other pages: disposition

Each row from `grep -rhE --include=*.record.md -e '→ R-16( \(corrected by pass 5\))?$'`. "Carried" gives the section.

| # | Moved row (short) | Disposition |
|---|---|---|
| 1 | MCP key storage: plain, in the Lab's own store | **Carried**, section 0 last row and `mcp-credentials.ts:1-100`: stored as written, unencrypted, in the host's store, `setAt` only readable, `secret` keeps it out of debug reads, max 4096 characters, no whitespace or control characters. |
| 2 | SQLite store persists, file location, owner (one user, one conversation per worker) | **Carried**, section 2.2 last row and section 0. The file location is the example's (`labs/teammates`), not a framework default. |
| 3 | Failed request: error item and prior items persist, durable with `sqliteStores`, lost in-memory | **Carried**, section 13. Marked [impl] for the writer I read. |
| 4 | Default store, startup line, production warning | **Carried**, section 1.1, with the test. |
| 5 | `sqliteStores` options, file created when missing, "one server writes while other processes read" | **Carried and sharpened**, section 2.2: a second writer waits 5 s then fails `SQLITE_BUSY`; readers unaffected **[run]**. The directory is not created. |
| 6 | Postgres with several servers | **Carried**, section 11 and section 14. |
| 7 | Fourth store (folder of files), options | **Carried**, section 2.1. |
| 8 | Ownership of a session; user-state key, org-state key, default org | **Carried**, section 4 and the bullets after it. |
| 9 | User and org records not split by tenant; only sessions | **Carried**, section 3. |
| 10 | Items stored on the request record; session list assembled from request records in one order on read | **Carried with a correction**: items are on the request record only on filesystem and in memory; SQLite and Postgres keep them in `request_items` rows and join on read. The listing order is `updatedAt` desc by default (section 6, 13). |
| 11 | Store rows: filesystem write guarantees across processes; in-memory persists nothing; session ownership and who can resume | **Carried**, sections 2, 4, 8. "Who can resume": the request's owner (`callerReachesRequest`), `ru:191-213`. |
| 12 | Stores: what each persists; in-memory default; SQLite and Postgres profiles | **Carried**, section 2. |
| 13 | In-memory cannot continue a crashed run; `durable: true` over memory pauses work in one process only | **Carried**, section 1.1. |
| 14 | Suspension record field list and what `blockInstanceId` means; ownership table (durable-execution lines 374-383) | **Carried**, below (14a). |
| 15 | Trace store: record shape, backends, `maxRequests`, `maxBytesPerRequest`, failed-write behaviour | **Carried**, section 12. |
| 16 | Ephemeral filesystem: what each store keeps across invocations | **Carried** as [guide]-marked, section 14. |
| 17 | `vercelPostgresStores()`: pool options, Neon client, connection string order, schema init skipped | **Carried**, section 2.4. |
| 18 | `createPostgresStores` / `skipSchemaInit`: schema init on every call, advisory lock; drop the statement count | **Carried**, section 2.3 (no count stated). |
| 19 | Filesystem store: container's disk, lasts the container's lifecycle | **Carried** as [guide], section 14. |
| 20 | Store durability table: filesystem survives restart, lost on redeploy; SQLite on a mounted volume survives both | **Carried** as [guide], section 14. |
| 21 | `@flow-state-dev/store-sqlite` depends on `better-sqlite3`, "needs build tools at install time"; `createSQLiteStores` takes `filename` | **Carried in part**: the dependency, version and `filename` (section 2.2). **Dropped: "needs build tools at install time."** Not provable from the package: `better-sqlite3` ships a built binary for common platforms and compiles only when none matches; the repo cannot show which hosts need build tools. The Railway guide says this (`deploying-to-railway.md:211,295-301`); a page may say it as the guide's advice for a fallback build, not as a fact. |
| 22 | Store concurrency table (corrected by pass 5) | **Carried**, section 8, with the 5000 ms wait and `SQLITE_BUSY` **[run]**. "One file cannot be shared across replicas" stays [guide]. |
| 23 | Store paths: `rootDir` (required, no default; example passes `.flow-state-data`), SQLite `filename` | **Carried**, sections 2.1, 2.2, 14. |
| 24 | Which stores persist across invocations on a host whose disk is discarded; module-scope connection advice stays in recipe | **Carried** as [guide], section 14. The connection advice is not a store fact: left to the recipe. |
| 25 | SQLite one writer, one process per database file; Postgres for multiple instances | **Carried**, sections 2.2, 8, 14. "One process per file" is stronger than the code: a second *process* can write, waiting up to 5 s **[run]**. State "one writer at a time", not "one process". |
| 26 | SQLite requirements: platform-built `better-sqlite3`; no system `libsqlite3` (corrected by pass 5) | **Carried**, section 2.2 (vendored SQLite, **[run]** `deps/sqlite3`, `build/Release`). The Docker guide's `libsqlite3-0` line (`deploying-with-docker.md:45-47`) is the thing pass 5 corrected; it is unnecessary. |
| 27 | Same, second wording | Same row as 26. |
| 28 | Change bus: `bus` slot, in-memory default, crossing buses, effect on `pollIntervalMs`, cases that miss changes | **Carried**, sections 10 and 11. `pollIntervalMs` is a client option (default 3 s on `client.live`). |
| 29 | Request record `result` | **Carried**, section 13. |
| 30 | `transient` blocks: trace items not stored; `result` output still is | **Carried**, section 12 last row. |
| 31 | Store requirements for dispatch-only and worker-only processes | **Carried**, section 14. |

### 14a. Suspension record fields and `blockInstanceId` (row 14)

Fields of `SuspensionRecord` (`core/suspension.ts:44-110`): `suspensionId`, `requestId`, `flowKind`, `flowId?`
(the instance a resume re-enters; absent on old records, fall back to `flowKind`), `actionName`, `sessionId?`,
`userId`, `reason` (`"user_approval" | "user_input" | "external_event"` or any string), `kind?`, `title?`,
`message`, `data?`, `resumeSchema?` (JSON Schema, not a Zod instance), `render?`, `allow?` (absent means
`["approve","reject"]`), `status`, `blockInstanceId`, `stepIndex`, `stepInput?`, `createdAt`, `expiresAt?`,
`resolvedAt?`, `resolvedBy?`, `resumeData?`. `pending` is the only non-terminal status; terminal:
`approved`, `rejected`, `submitted`, `skipped`, `timed_out`, `expired`, `stopped`, `cancelled`
(`core/suspension.ts:116-127`). No `orgId` or `tenantId` on it: both are on the request it joins to (`ty:1790-1805`).
`blockInstanceId`: `${requestId}:${path}:${attempt}`, a function of (request id, structural path, retry attempt),
so a resume gives the same id for the same step. `attempt` is a 0-indexed retry counter, so a retried attempt carries a different id: the doc comment's "retries produce the same ID" is not supported by the format, and the page must not state it. `path` is slash-delimited
(`root/step[0]/iter[2]`); user-controlled segments are percent-escaped for `% / [ ] :`. Treat it as an opaque
string. `contracts/src/block-instance-id.ts:1-27`.

Ownership of each durable part (the "what a store holds per gate" table) is the section 0 table:
suspension (owner: request's user and flow), checkpoint, lease (60 s default is an engine constant, not in the
store contract: do not state it here), wake, runOnce, item log.

## 17. Not on this page (named so the writer does not invent them)

- The offline attribution procedure for `flow_id` and `org_id` (inventory SQL, backfill statements, moving
  an isolated copy's org data, "when to stop"; `ov:119-255`). It is an operator's one-time migration
  of existing data, and belongs on the release's Upgrading page, not a Reference table. Its two verifiable
  anchors are carried here: the `409 migration-required` behaviour and the key forms (section 4).
- Operator guidance on `pg_repack` and Postgres item-storage rollback (`ov:352`) is in the package README
  (`store-postgres/README.md`), not verified here.
- The State Operations page owns which calls take the delta-verb path.
- How the Resources page treats `flowIsolation` and `isolateUserState`: here only the keys they produce.

## 18. Contradictions found (existing page vs code)

1. `ov:346` and `setup.md:101` say the filesystem store appends items. Code: items are inline on the record
   (`frs:140-147,529-579`).
2. `ov:11` says `queue` and `scheduler` slots exist (and `blobs` is a no-op). Code: no such slots; `blobs` backs
   attachments (`store-adapter.ts:29-33`, `rs:70-144`).
3. `ov:285,308,338` import `WakeStore`, `isBatchStillAuthorized`, `createInMemoryBus` from
   `@flow-state-dev/engine`. They are on `/host` (`eh`).
4. `ov:58` describes legacy `.runonce.<key>.json` files and `.quarantined` renames. No code does either.
5. `ov:385` says metadata filtering is unavailable and offers no server-side lookup. The readonly-state filter is
   server-side (`sr:182-211`, `core/flow.ts:360-368`).
6. `deployment.md:46-52` marks Postgres "coming soon"; `deploying-to-railway.md:279` lists Postgres or MongoDB
   "when available". `@flow-state-dev/store-postgres` ships.
7. `store-sqlite/README.md` and the Railway guide import `createSQLiteStores` from the package root; it is on `/host`.
8. `si:155-161` says the filesystem store has "O(N^2) event persistence"; `frs:135-139` appends only new events.
9. `ov:11,21` and the brief both say "the in-memory, file and SQLite adapters don't [back `bus`]": confirmed
   (`si:274,294`, `sqr:98`), no contradiction. Listed so the writer does not re-check it.

## 19. Things for pass 5 to run before the page states them

- `[impl]` rows: session-failure writer (`ra:495-600`: confirm with a failing action over SQLite that the record
  has `status: "failed"`, `result.error` and an `error` item, then read it after a restart); `request-principal.ts`
  id rewrite; `OrgBindingMismatchError` on running a session under another org; the delta-verb fallback
  (`scope-persist.ts`); `birthSession` reclaiming tombstones.
- Whether a SQLite registry opened a second time in a second process while the first holds a write
  transaction fails with `SQLITE_BUSY` through `createSQLiteStores` itself (I ran raw `better-sqlite3` with the same
  PRAGMAs, not the store).
- `packages/engine/test/org-boundary-routes.test.ts`, `flow-instance-ownership.test.ts`, `record-owner.test.ts`:
  cited by name for the `migration-required` behaviour; I did not read them line by line.
- Section 14 guide rows are unverified against any host.

## Pass 8 (revise round 2)

- Log prefixes checked: `[flowstate] active profile` is in `createFlowState.ts:1028,1030`; `[flow-state] this host keeps no wakes` is in `durability/request-wakes.ts:106`. Both differ in the source and the page states each as logged.
- `landBy` (`ty:1851-1864`): the writer's request lease; a pass that finds nothing owed before it moves the wake to `landBy` rather than clearing it. Page wording follows.
- No-wakes effect: debts are paid on fast paths only, so a host without `wakes` does not retry work owed by a time after a crash (wording from the log text and `ty:1835-1904`).
- Cut: "Each read costs what is running and what changed recently" (no observable bound found); SQLite `sharedAcrossProcesses` reason; the Upgrading-page pointer on records with no org.
