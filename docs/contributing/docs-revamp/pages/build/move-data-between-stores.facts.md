# Facts for Move data between stores (B-31, recipe)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, `docs/internal/`, `CLAUDE.md`, PR or commit was read. Nothing in this pass was run; every row is read from source, so rows that depend on behaviour are marked **[verify]**.

Paths are from the repo root. Abbreviations:

- `st` = `packages/engine/src/stores/types.ts`
- `sa` = `packages/engine/src/stores/store-adapter.ts`
- `fst` = `packages/engine/src/flowstate/types.ts`
- `pe` = `apps/docs/docs/persistence/overview.md`
- `sql` = `packages/store-sqlite` (`sql/README.md`, `sql/src/...`)
- `pg` = `packages/store-postgres` (`pg/README.md`, `pg/src/...`)
- `eng` = `packages/engine` (`eng/README.md`)
- `ls` = `packages/fsdev/src/local-store.ts`

Legend: **[page]** the page states it. **[ref]** belongs on `reference/stores`; the page links and does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[conflict]** two sources disagree; the code wins. **[plan]** the sitemap entry disagrees with the code; the page owner decides.

The page's one app is the support desk (flow `support`, organization `acme`), as on C-14.

## 0. Items for the page owner before drafting

1. **[plan] There is no export call and no import call.** Nothing in the exported surface, the CLI commands (`packages/fsdev/src/commands/` has `benchmark`, `block`, `chat`, `dev`, `gen`, `run`, `serve`, `ui`, `worktrees`), the READMEs, the docs or `goals/` copies data from one store to another. A search for export, import, copy and migrate verbs over `packages/*/src`, the docs and `goals/` found none that moves records between adapters. The sitemap's steps "export · import" therefore describe a script the reader writes, not a command. The recipe's honest shape is: open the old store and the new store, read from one, write to the other, count, switch. State this in the opening line of step 2; do not name an `fsdev` command.
2. **[plan] The sitemap's source is the wrong page.** B-31's source is "`persistence/overview` (the data-migration operations page)". That page's moving content (`pe:119-254`) is the one-time attribution of owners and organizations to records written before `flowId` and `orgId` existed. It never moves data between adapters. The only line on that page about moving data across kinds of store is the custom-store row: "Use your store's own export and restore" (`pe:184`). The attribution procedure is a different task from B-31 and belongs to the Upgrading page and `reference/stores`; B-31 links to it in one clause (section 7).
3. **[plan] "Move rows, not calls" is the old page's rule, and it applies only inside one kind of store.** `pe:186` says to move rows directly and not to go through `set` and `delete`, because the calls mint new versions and drop deletion markers. That is advice for editing one SQL database in place. A move from one adapter to another cannot copy rows (different table and file layouts), so the calls are the only route, and the loss is real (section 4). The page must say what the copy keeps and what it loses, which is the sitemap's question "What is copied and what is not?".
4. **[plan] The two directions the reader meets.** Per the persistence concept's facts: a developer's data is in `.fsdev/data/fsdev.db` (SQLite) when `fsdev dev` runs with no config (`ls:5-6`, `ls:73-80`); production is Postgres. The page's example is SQLite to Postgres. The in-memory store cannot be a source (section 3).
5. **[plan] Four stored-part questions are answered in section 2** because the page moves stored data. The page states them as "What is copied and what is not" and does not repeat C-14's figure.

## 1. What the reader has in hand

The page's code opens both stores through their adapters. Every adapter is a `StoreAdapter`; `resolve(slots)` returns the registry, and `dispose()` releases it.

- A store is chosen once, on `createFlowState({ stores })`. `stores` takes one adapter (`sqliteStores({ filename })`), which means exactly `{ default: { primary: adapter } }`, or named profiles. Flows, blocks and actions do not name a store. `fst:200-211` (the `stores` doc, `fst:199-211`). [page]
- A `StoreAdapter` has `capabilities`, `resolve(slots)` returning `Promise<Partial<StoreRegistry>>`, and an optional `dispose()`. `sa:46-66`. [page: the script calls `adapter.resolve(["primary"])` and `adapter.dispose()`]
- `sqliteStores(options)` is imported from `@flow-state-dev/store-sqlite`; its adapter backs `primary` only. `packages/store-sqlite/src/index.ts:9`; `sql/src/registry.ts:95-107`. [page]
- `postgresStores(options)` is imported from `@flow-state-dev/store-postgres`; its adapter backs `primary` and `bus`. `packages/store-postgres/src/index.ts:11`; `pg/src/registry.ts:256-268`. [page]
- `filesystemStores({ rootDir })` is imported from `@flow-state-dev/engine`; it backs `primary` and `blobs`. `eng/src/stores/index.ts:284-299`; `pe:48-53`. [page: only if the reader's source is the filesystem store; otherwise one clause]
- `sqliteStores({ filename })`: the file is created if it does not exist; `skipSchemaInit` skips table creation. `sql/README.md:37-44`. [page: tables are created when the adapter opens, so an empty target needs no setup; the `skipSchemaInit` option is [ref]]
- `postgresStores` with `connectionString` omitted reads `FSD_DB_URL`, then `DATABASE_URL`, and throws if neither is set. `pg/src/registry.ts:129-150`; `pg/README.md:38-46`. [page: example passes `connectionString`]
- The Postgres adapter creates its tables when it opens, unless you pass `skipSchemaInit`. `pe:285`; `pg/README.md:270`. [page: one clause on the target]
- **[conflict]** `sql/README.md:15-30` imports `createSQLiteStores` from the package root. The package root exports `sqliteStores` and `createSQLiteScheduleIndex` only; the registry factory is on `@flow-state-dev/store-sqlite/host`. `packages/store-sqlite/src/index.ts:9-10`, `:5-7`. The page imports `sqliteStores`.
- `fsdev dev`, `fsdev run` and `fsdev chat` with no app config share `.fsdev/data/fsdev.db`; `--store filesystem` keeps JSON files under `.fsdev/data` instead. A command with an app config uses the app's stores and refuses `--store`. `ls:1-12`, `ls:27-28`, `ls:55-70`. [page: one sentence, where the reader's source file is]

## 2. The four questions, for each stored part

Who owns it, who can see it, where it is stored, how many exist. Every row reads from the record types in `st` and from the adapter tables in `sql/README.md:87-94` (the same tables exist in Postgres, `pg/src/schema.ts`). The "copied?" column answers the sitemap's question and is explained in sections 3 and 4.

| Part | Owns it | Who can see it | Where stored | How many | Copied by this recipe? |
| --- | --- | --- | --- | --- | --- |
| Session record (state, `journal`, tags, metadata) | one user, in one organization; stamped with the flow instance that created it (`flowId`) | blocks in its requests; the browser sees the items and the state a flow exposes | `sessions` table | one per session id (per tenant) | yes |
| Request record, its items, its stream events | the session it ran in | the session's owner, through the session routes | `requests`, `request_items`, `request_events` | one per request | yes |
| User record (user-scoped state) | one user, in one organization | blocks of that user's sessions in that organization | `users` table | one per (user, organization); one more per flow copy that isolates user state | yes |
| Org record (org-scoped state) | the organization | blocks of every user's sessions in the organization | `orgs` table | one per organization; one more per flow copy that isolates org state | yes |
| Resource state | the scope it is declared on (session, user or org) | blocks of that scope; the browser for fields the flow exposes | `resource_state` | one row per resource key per scope instance; a deleted key keeps a marker row | yes, with a new version (section 4) |
| Resource content | the same scope | the same | `resource_content` | one row per resource key per scope instance | yes |
| Paused runs (suspensions, checkpoints) | the request that paused | the user who answers it | `suspension_records`, `sequencer_checkpoints` | one per pause | no (section 5) |
| Traces | the request | the DevTool | `trace_events`, `trace_request_roster` on SQLite; in memory on Postgres | up to 1000 requests on SQLite when `NODE_ENV=development`, 50 otherwise | no (section 5) |
| Leases, active-request entries, wakes | the request or session they guard | the runtime only | `leases`, `active_requests`, `wakes` | one per held run or due debt | no (section 5) |
| Attachment bytes | the session | the session's owner | the `blobs` slot: files under `.fsdev/blobs/<profile>` when sessions persist; `<rootDir>/blobs` on the filesystem store | one per attachment | no (section 5) |
| Dynamic schedules | the organization of the execution that wrote them | the scheduler | `schedule_index` | one per schedule | no (section 5) |

Citations for the table:

- Scope records live in `sessions`, `users`, `orgs`; request items and events in `request_items` and `request_events`; resource state in `resource_state`; content in `resource_content`; checkpoints, suspensions, leases, traces in dedicated tables; wakes in `wakes`. `sql/README.md:87-94`. [ref for the table names; the page names tables only where a count query needs one]
- Postgres has the same tables: `pg/src/schema.ts:9` (`sessions`), `:42` (`requests`), `:174` (`users`), `:188` (`orgs`), `:204` (`active_requests`), `:421` (`resource_content`), `:435` (`resource_state`), `:496` (`request_events`), `:512` (`request_items`), `:532` (`sequencer_checkpoints`), `:554` (`schedule_index`), `:574` (`request_runonce`), `:593` (`suspension_records`), `:660` (`leases`), `:677` (`wakes`). SQLite: `sql/src/schema.ts:14`, `:79`, `:122`, `:133`, `:146`, `:376`, `:389`, `:406`, `:422`, `:469`, `:502`, `:512`, `:531`, `:551`, `:569`, `:583`. [ref]
- A session belongs to one user and one organization, set at creation, and cannot move to another organization. `eng/src/context/binding-errors.ts:46-51`. [page: the copy keeps `userId` and `orgId` on each record as they are]
- Every session and request records `flowId` next to `flowKind`. `st:33-55`; `pe:121`. [page: copied verbatim]
- User records are keyed by user and organization: the same user in two organizations has two records. `eng/test/user-cell-keys.test.ts:36-45`; `goals/user-scope/keeps-a-users-data-in-the-org-it-was-saved-in/goal.md:4`. [page: so copy user records by what `list` returns, never by user id]
- Org records are one per organization; user and org records for a flow copy that isolates state are one more each. `pe:125`; `eng/src/stores/scope-keys.ts:194-240`. [ref]
- The SQLite trace store keeps up to 1000 requests when `NODE_ENV=development` and 50 otherwise. `sql/README.md:45`. The Postgres adapter builds `traces` as an in-memory trace store. `pg/src/registry.ts:20`, `:236`. [ref]
- Attachments: a profile that names no `blobs` keeps them under `.fsdev/blobs/<profile>` when the sessions persist, in memory when they don't; `filesystemStores` backs `blobs` under `<rootDir>/blobs`. `eng/src/flowstate/resolve-slots.ts:132-142`; `eng/src/stores/index.ts:279-297`. **[conflict]** `sa:23-24` and `pe:11` say `blobs` is reserved and a no-op; the code ships a blob store. The page follows the code. [page: one clause in "What is not copied"]
- The `BlobStore` interface has `put`, `head`, `read`, `claim`, `release`, `confirm`, `deleteOwner` and `delete`; it has no listing call. `eng/src/blobs/types.ts:66-106`. [page: the reader copies the folder, not records]

## 3. What the script can read from the old store

The store interfaces are the only route between two different adapters, and what they let you enumerate decides what a copy can reach.

- `SessionStore.list(options)`, `UserStore.list`, `OrgStore.list` and `RequestStore.list` return records. `st:790`, `:1131`, `:1143`, `:863`. [page]
- With no `limit`, SQLite applies none and returns every row. `sql/src/sqlite-store.ts:357-365`. **[verify]** for Postgres and the filesystem and in-memory stores. [page only as "page with `limit` and `offset`"]
- **A session listing with no options returns top-level sessions only.** `parentage` omitted narrows to `"top-level"`; pass `parentage: "all"` to get child sessions (sessions another session started). `st:479-489`. [page: this is the first way a copy silently loses data, and the sheet's most important edge case]
- A session list paged by offset can skip or repeat a record if records change between pages; `orderBy: "createdAt"` orders by `(createdAt, id)`, both immutable. A record created mid-walk still shifts later pages. `st:495-516`. [page: one sentence; the quiesce step makes it moot]
- `SessionListOptions.tenantId`: present means exact match, absent means no tenant filtering. Session records' `id` is the tenant-namespaced storage key (`${tenantId}:${sessionId}`) and `tenantId` holds the bare tenant. `st:54-59`; `st:458-466`. [page: copy each record under the `id` it came with; do not rebuild ids]
- `RequestStore.list({ sessionId, withItems })` lists a session's requests; items are loaded only when `withItems: true`, on the SQL adapters. `st:525-600`. [page]
- `RequestStore.getEvents(requestId)` returns a request's stream events in sequence order; omitting `fromSequence` returns the full log. `st:1027`, `:1020-1026`. [page]
- `ResourceStateStore.getAll(scopeType, scopeId)` returns every live resource state in a scope instance, each with its version; `ContentStore.getAll(scopeType, scopeId)` returns every content entry. `st:1592-1596`, `:1273`. [page]
- The scope types are `"session"`, `"user"`, `"org"` and, for session-scoped resources marked `sharedToLineage`, `"lineage"`. `st:1233`, `:1254`. The lineage address is the session's `lineageId`. `st:73-94`. [page: one clause; a script must read `lineage` scopes too]
- The scope id a resource sits under is the record's storage key for a session, and for user and org resources it is a bucket the flow's isolation settings choose, `<user>:~org:<org>` or `<org>` shared, with the flow instance id added when isolated. `eng/src/stores/scope-keys.ts:403-440`, `:441-470`. `resourceScopeIds`, the function that enumerates the buckets, is not exported from the package. `eng/src/index.ts`, `eng/src/host.ts`, `eng/src/internal.ts` (no match). **[verify]** [page: a script reads each user and org record's id as the scope id, and also asks the flow's declared isolation; **do not** state a bucket recipe the page cannot back with an exported call. Offer: copy every scope id you can derive from the records `list` returns, then check counts per scope (step 4)]
- `ContentStore` and `ResourceStateStore` have no call that lists scope ids. `st:1263-1318`, `:1516-1700`. [page: this is the reason step 1 is "what to move": the script walks sessions, users and orgs, then asks each scope for its state and content]
- `TraceStore.listRequestIds()` and `getEvents` exist. `st:1745-1760`. `SuspensionStore.list(filter)` exists. `st:1776`. `CheckpointStore` has `latest(requestId, blockInstanceId)` and no listing call. `st:1704-1722`. [ref]
- `RequestStore.getRunOnceResult(requestId, key)` and `setRunOnceResult` take a key; there is no listing call, so memoized `ctx.runOnce` results cannot be enumerated. `st:1053-1070`. [page: one clause under "not copied"]
- **The in-memory store is not a source.** It lives in one process, and a fresh instance is a separate dataset. `pe:32`, `pe:405`. [page: one sentence in step 1; moving from memory means there is nothing to move after a restart]

## 4. What a copy through the store calls keeps and loses

- Scope records (session, user, org): `set(id, value, "any")` writes unconditionally, and "the `version` field on `value` is the NEW version to persist", so a record keeps the version it was read at. `st:763`; `st:658` (`"any"`: "write unconditionally (used for creates, migrations, and system writes...)"). [page]
- `set(id, value, "absent")` writes only when no record exists at the id and returns the stored record on conflict. `st:773-778`. [page: use it on the target so a rerun does not overwrite a record the new store has since changed]
- Resource state: `ResourceStateStore.set` takes no version to store, only an expected version; a new row starts at version 1 and a recreate continues from the tombstone's version. Memory implementation `eng/src/stores/memory/resource-state-store.ts:124-128`; contract `st:1529-1545`. So **every copied resource state is at version 1 on the target.** [page]
- Deleted resources keep a marker row (version retained, payload dropped) and a read returns nothing for them. `st:1566-1570`; `pe:103-107`; `sql/README.md:107`. `ResourceStateStore.getAll` returns live rows only. `st:1592-1596`. So **markers do not copy**: a key deleted before the move reads as never written afterwards, and a writer holding a pre-move version no longer collides with a later recreate. [page: stated as a limit, flat]
- `pe:186`: "Going through the normal `set` and `delete` API mints new versions and drops markers." [conflict with nothing; it is the same fact, from the old page]
- `pe:186` says rows should be moved, not calls, for attribution work on one SQL database. That advice does not apply across adapters (section 0, item 3). [not on the page]
- Request records: a `set` that leaves `items` off keeps the stored items, and the SQL adapters keep items out of `set` and in `request_items`, written through `persistItems`. `eng/README.md:869`; `st:889`, `:353`. [page: write the request record, then `persistItems(requestId, items)` and `await flushItems(requestId)`; both are on `RequestStore`]
- Request stream events are written with `persistEvents(requestId, events)` and `await flushEvents(requestId)`. `st:1012-1018`. [page]
- A request's `id` is caller-supplied and a request id can be reused, so deleting a request on the target removes everything under the id. `eng/README.md:827`. [ref]
- Items on a SQLite or Postgres store written by an older version into `requests.data` are not read by the current adapters and will not be seen by `list` or `countItems`; such a database must be moved aside or the requests dropped. `sql/README.md:127`; `pg/README.md:227`. [ref: one clause may link]
- `RequestStore.countItems(requestId)` returns the persisted item count and "reflects flushed writes only". `st:917-922`. [page: use it for the count check on items]

## 5. What is not copied, and why

- **Paused runs.** Suspensions and checkpoints belong to requests that are mid-run; a stop is held only while a server runs on the store. `fst:336-346`; `goals/durable-by-default/a-local-stop-is-held-and-answered/goal.md:3`. The recipe quiesces first (step 2) and answers or discards every stop before the move. `SuspensionStore.list` can show the pending ones. `st:1776`. **[verify]** [page: a stop that is still pending when the copy runs is not on the new store]
- **Leases, active-request entries, wakes.** They describe runs in flight in one process and debts a host reads at start. `st:1814-1830`, `:1146-1191`, `:1841-1906`. `StoreRegistry.wakes` is optional; a host that finds none logs once and runs without wakes. `st:1906-1923`; `pe:285`. [page: one clause, "the new store starts with none"]
- **Traces.** The Postgres adapter keeps them in memory (section 2), and SQLite keeps up to 1000 or 50 requests. They are debugging history, not user data. [page: one clause]
- **Attachment bytes.** They are not in `StoreRegistry` records; copy the blob folder the `blobs` slot uses (section 2). [page: one clause with the folder name]
- **Dynamic schedules.** `schedule_index` is its own table, written through `createSQLiteScheduleIndex` / `createPostgresScheduleIndex`, outside `StoreRegistry`. `packages/store-sqlite/src/index.ts:10`; `packages/store-postgres/src/index.ts:12`; `sql/README.md:59-69`. The old page has a procedure that rebuilds the schedule index one organization at a time after attribution. `pe:244`. **[verify]** whether a plain copy of resource state is enough to refill the index; the schedule collection mirrors on write. [page: say "dynamic schedules are not copied", link to the schedules page; do not state a rebuild call]
- **Runtime-only per-request caches** (`ctx.runOnce` results). Section 3. [page: one clause]

## 6. How the reader checks it worked (sitemap Q2) and switches

- Counts per list: `SessionStore.list({ parentage: "all" })` length, `UserStore.list()` length, `OrgStore.list()` length, and per request `countItems`. `st:790`, `:1131`, `:1143`, `:915`. [page]
- Counts per scope: the number of keys `ResourceStateStore.getAll(scopeType, scopeId)` and `ContentStore.getAll(scopeType, scopeId)` return on source and target for each scope id the script copied. `st:1273`, `:1592`. [page]
- A resource with content but no state is not seen through a state listing, and a state listing hides markers, so a count of keys from `getAll` on the state store is not a count of the content store's keys. `pe:146` ("a resource with content but no state never shows up in a state listing at all"). [page: compare state to state and content to content, never one to the other]
- Whole-database counts in SQL on the two ends, for the tables in section 2, are the cross-check an operator trusts most: `SELECT COUNT(*) FROM sessions;` on both. `sql/README.md:87-94`. The old page uses the same kind of query for its read-back: `SELECT COUNT(*) FROM sessions WHERE ...;`. `pe:168`. [page: one query as an example; the other tables are the reader's analogue]
- A session read through the new server: reading a session's state and resources through each copy before admitting traffic is the old page's final check. `pe:168`. [page: step 4's last line: open one real session and read its state through the new store]
- Records with no `flowId` and a collection flow answer `409 { "error": "migration-required" }` after the copy exactly as before, because the copy keeps the field unchanged. `pe:123`; `st:33-55` (`flowId` optional, absent on old rows). [page: "A copy keeps `flowId` and `orgId` as stored. Records that needed attribution on the old store still need it." Link to Upgrading]
- A token stop: the old page's rollback is "restoring the backup", and "after the converted store has taken new writes it is the only correct one". `pe:170`, `:252`. [page: until the switch, the old store is untouched, so keep it]
- Switch: change `stores` on `createFlowState` from the old adapter to the new one, and restart. `fst:200-211` (the `stores` doc, `fst:199-211`). `stores` resolves the profile named by `FSD_ENV`, then `defaultProfile`, then the first declared profile. `fst:210-219` (the `defaultProfile` doc: `FSD_ENV`, then the value, then the first declared profile). [page]
- Profile-per-environment: the knowledge-base example picks a dev profile (filesystem under `.fsdev/data`) or a prod profile (`postgresStores({})`) from whether `FSD_DB_URL` or `DATABASE_URL` is set. `examples/knowledge-base/fsdev.config.ts:21-45`. [page: the example for the switch step; one clause]
- `fsdev run` and `fsdev dev` use the app's stores when an `fsdev.config.ts` exists, so after the switch they read the new store. `apps/docs/docs/cli/configuration.md:17`; `apps/docs/docs/cli/agent-dev-loop.md:33`. [ref: one clause]
- A Postgres target with more than one process gets change notices across processes; SQLite and the filesystem do not. `pe:13-21`, `pe:340`. [ref: C-14; one clause at most]

## 7. What the page links and does not state

- Which store to choose, what each keeps across a restart: C-14, `concepts/persistence`.
- Adapter options, table names, concurrency by store, deletion markers, custom stores and their conformance suites: `reference/stores`.
- Attributing owners (`flow_id`) and organizations (`org_id`) on records written before those fields existed: the release's Upgrading page and `reference/stores`; `pe:119-254`. [ref: one clause]
- Tenant isolation: C-17.

## 8. Edges the cold-read questions can use

1. Child sessions (a session another session started) are missing from a `list()` with no options. Section 3.
2. A resource deleted before the move comes back as never written; its old version is gone and a new one starts at 1. Section 4.
3. A user who works in two organizations has two user records; a script that lists users copies both. Section 2.
4. The same script run twice: `set(..., "absent")` on the target leaves what the new store already holds. Section 4.
5. A stop pending at the moment of the copy: the new store does not hold it. Section 5.
6. The old store is untouched until the switch, so the rollback is to point `stores` back. Section 6.
7. A tenant-namespaced session id (`t1:s1`) is copied as the record's own `id`. Section 3.

## 9. Left out for lack of an observable surface

- A bulk-load or import call on any adapter: none found.
- Table-level copy between SQLite and Postgres (`pg_dump`-style, `COPY`): no doc or script describes it for this schema; keep off the page.
- Postgres and filesystem listing defaults with no `limit`: not read in this pass **[verify]**.
- A supported way to enumerate every user and org bucket a flow isolates: `resourceScopeIds` is not exported. **[verify]**

## 10. Revise round 1 corrections

- `RequestRecord.sessionId` is the bare session id; a tenant session's `SessionRecord.id` is `${tenantId}:${sessionId}` and `tenantId` holds the bare tenant. `st:50-59`, `st:140-157`, `eng/src/stores/scope-keys.ts:229-250`, `eng/src/routes/session-routes.ts:646-650`. The page lists a session's requests with the bare id and `tenantId: session.tenantId` (id minus the `${tenantId}:` prefix). [page]
- `persistItems` and `persistEvents` return `void`; `flushItems` and `flushEvents` return `Promise<void>`. `st:889-896`, `st:1012-1018`. The unawaited calls are correct. [page]
- Both adapters create a table named `sessions`; SQLite also has `resource_content`. `sql/src/schema.ts:14`, `pg/src/schema.ts:9`, `pg/src/schema.ts:421`. The count check adds `SELECT COUNT(*) FROM resource_content;` because `resource_state` also holds deletion markers, which do not copy. [page]
- The `lineage` scope is the space for session resources declared `sharedToLineage`, addressed by the session's `lineageId`. `st:73-94`, `st:1241-1254`. [page]
- Limits that left the recipe now live on `reference/stores` ("Moving data between stores") and `reference/resources` ("What gets stored", "Identity: path, scope and uri"): paused runs, attachment bytes, traces/leases/schedules, in-memory source, unattributed records, write modes, `parentage`, user records, Postgres schema creation, resource deletions and versions, state vs content, scope ids. [ref]
- Schedules are recreated as described on `reference/schedules` (R-33). [ref]

## 11. Revise round 2 corrections

- `"absent"` on a target write stores the record only if none exists at the id; an existing record is a conflict and is left as is. `st:773-778`. The page says so in step 2. [page]
- `persistItems` and `persistEvents` queue writes and return `void`; `flushItems` and `flushEvents` wait for them. `st:889-896`. The page says so after the step 3 prose. [page]
- `PostgresStoresOptions.connectionString` is `connectionString?: string`, so `process.env.FSD_DB_URL` (`string | undefined`) type-checks. `pg/src/types.ts:81`. No page change. [verified]
- `sessions` and `resource_content` exist on both SQLite (`sql/src/schema.ts:14`, `:421`) and Postgres. The count query is valid on both. [verified]
- Copying user records by user id writes one record where a user in two organizations has two. `st` user records keyed by user and organization (section 2). [page]

## 12. Revise round 3 corrections

- A user record's `id` is its storage key and differs from `userId`; a user in two organizations has two records under two `id`s (`<user>:~org:<org>`). The loop writes by `user.id`, so both copy. `st:423-426`, `st:27-33`, `eng/src/stores/scope-keys.ts:177-199`. The page says each record has its own `id`. [page]
- Records with no `flowId` or `orgId` copy without them; the reader sets both on the new store before switching, as `reference/stores` describes. [page]
