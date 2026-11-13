# Facts for Persistence (C-14, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. Where a line is in `packages/*/src` it is a doc comment or exported signature that a test or a goal also shows; the page states the behaviour, never the mechanism. No spec, `docs/internal/`, `CLAUDE.md`, PR or commit was read.

Paths are from the repo root. Abbreviations:

- `eng` = `packages/engine`
- `fst` = `packages/engine/src/flowstate/types.ts`
- `sql` = `packages/store-sqlite`
- `pg` = `packages/store-postgres`
- `pe` = `apps/docs/docs/persistence/overview.md` (the page this one splits)
- `su` = `apps/docs/docs/server/setup.md`
- `dt` = `apps/docs/docs/devtool/setup.md`
- `ls` = `packages/fsdev/src/local-store.ts`
- `kb` = `examples/knowledge-base/fsdev.config.ts`
- `uck` = `packages/engine/test/user-cell-keys.test.ts`
- `dbd` = `packages/engine/test/durable-by-default.test.ts`

Legend: **[page]** the page states it. **[ref]** belongs on `reference/stores` (or another Reference page, named); the page links and does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[conflict]** two sources disagree; the code wins and the note says which source is wrong. **[plan]** the sitemap entry's wording disagrees with the code; the page owner decides.

The page's one app is the support desk (flow `support`, customer's `plan`, organization `acme`). Names below are the page's, not the code's.

## 0. Items for the page owner before drafting

1. **[plan] The sitemap names three stores (memory, SQLite, Postgres); there are four.** A filesystem store ships in the engine: `filesystemStores({ rootDir, developmentOnly })`, `fst:169-178` and `eng/src/stores/index.ts:284-299` (adapter backs `primary` and `blobs`). `fsdev` offers it as `--store filesystem`, `ls:27-28`, `ls:63-69`. The old chooser lists it, `pe:26`, `pe:415-416`. The figure plan is "three columns, one per store". Recommendation for the page: three columns, and one sentence saying a fourth, a local-development file store, exists and is a Reference row. I cannot tell whether the cut is intended; it is the owner's call.
2. **[plan] "The default store" is two things.** `createFlowState` with no `stores` runs in memory, `fst:169-173`, and prints that nothing persists across a restart, `eng/src/flowstate/createFlowState.ts:967-976`. But `fsdev dev`, `fsdev run` and `fsdev chat` with no app config open a SQLite file, `.fsdev/data/fsdev.db`, `ls:5-6`, `ls:73-80`, `dt:128`. A reader running `fsdev dev` on a project with no `fsdev.config.ts` does keep data over a restart. Question 1 ("restart the dev server on the default store; what is gone?") has the answer "everything" only for a server built with `createFlowState` and no `stores`, or whose config names `inMemoryStores()`. The page must say which default it means. Same split on `your-first-flow.md:265`: "this example's store is in memory, so restarting the server starts over."
3. **[plan] "Paused runs" in the figure.** A paused run (one stopped by `ctx.suspend()` for an approval or an answer) survives a restart only when the store persists and durable execution is on; durable is on by default for persisting stores, `fst:307-319`, `eng/src/durability/default-durability.ts:20-31`. On the in-memory store the run is not held at all (section 5), so the in-memory column's cell is "never held", not "lost on restart".
4. **The `stores` shape.** The old page and the sitemap example write `stores: { default: { primary: adapter } }`. The type also accepts the adapter alone: `stores: sqliteStores({ filename })`, which means exactly `{ default: { primary: adapter } }`, `fst:169-179`. Examples can use the short form. Named profiles are for an app that picks a store per environment (section 6).
5. **Conflicts with the old page that the new page must not copy** are in section 10.

## 1. What gets stored

Four stored parts for the figure (sessions, state, resources, paused runs), plus the items a session accumulates and the requests that made them. The four questions asked of each follow in section 2.

- The store is where the app keeps its data. `fst:169` ("Where the app keeps its data"). [page]
- Three categories of data: scope state (session, user, org), resources, and items (the accumulated conversation log). `pe:7`. [page]
- Beyond those, the primary store backs sessions, requests, users, orgs, active requests, checkpoints, content, and traces. `eng/src/stores/store-adapter.ts:22-26` (doc comment on the `primary` slot). [ref: reference/stores; the page says "sessions, requests, state, resources and paused runs" and no more]
- Items: persisted by default; `status` items are always transient; `state_change` and `resource_change` are transient in production. `pe:115`. [ref: reference/stores or the sessions page C-06; one clause at most] [verify the production clause]
- The SQLite adapter's own table of what it keeps, by running code's name: scope records (session, user, org), request items and stream events, resource state (single and collection instances), collection index entries and build markers, resource content (artifacts, collection bodies, client data), sequencer checkpoints, suspensions, leases, traces, and wakes. All "Yes". `sql/README.md:87-94`. [page: the first five as plain nouns; the rest [ref]]
- Sequencer checkpoints and suspensions are what a paused run is made of; both persist on SQLite. `sql/README.md:94`; filesystem constructs `suspensions`, `leases`, `wakes` on disk, `eng/src/stores/index.ts:255-258`. [page: "a paused run"]
- Wakes: when a session's pending work falls due. `sql/README.md:95`, `:155`; `pe:285`. [ref]
- Traces: the SQLite store keeps up to 1000 requests' traces when `NODE_ENV=development` and 50 otherwise, unless `traceStore.maxRequests` is set. `sql/README.md:45`; `eng/src/stores/index.ts:164-165`. [ref]
- The Postgres adapter keeps traces in memory, not in Postgres: its registry builds `traces: createInMemoryTraceStore()`. `pg/src/registry.ts:20` (import), `:236` (use). [ref; keep off the page]
- Attachments live in a `blobs` slot. A profile that names none keeps them wherever its sessions live: on disk under `.fsdev/blobs/<profile>` when the sessions persist, in memory when they don't. `eng/src/flowstate/resolve-slots.ts:132-138`. `filesystemStores` backs `blobs` itself, under `<rootDir>/blobs`, `eng/src/stores/index.ts:279-297`. [page: one clause, "attachments follow the sessions"; detail [ref]]
- **[conflict]** `pe:11` says the `blobs` slot is "forward-compatible: no backing store ships for them in Phase 1, so declaring them is a no-op." The code ships a blob store: `filesystemStores` declares `capabilities: ["primary", "blobs"]` (`eng/src/stores/index.ts:290`) and a local blob store is the default (`resolve-slots.ts:132-138`). The page does not repeat `pe:11`'s sentence about `blobs`.
- A resource has its own `scope` and persists with it: "Always persisted with their scope". `pe:114`. [page]

## 2. The four questions, for each stored part

Who owns it, who can see it, where it is stored, how many exist. Observations are from the cited tests, goals and docs; none was re-run in this pass except where marked [ran] (section 11).

| Part | Owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| Session (record, its state, its items) | one user, in one organization; stamped with the flow instance that created it | blocks in its requests; the browser sees the session's items and any state the flow exposes | the store's session records; items in their own rows on SQLite and Postgres | one per session id (per tenant) |
| Request (a run's record, items, stream events) | the session it ran in | the session's owner, through the session routes | the store's request records | one per request |
| User state (and user-scoped resources) | one user, in one organization | blocks of that user's sessions in that organization; the browser only for fields exposed | a user record keyed by user and organization | one per (user, organization); one more per flow copy that isolates user state |
| Org state (and org-scoped resources) | the organization | blocks of every user's sessions in the organization; the browser only for exposed fields | an org record keyed by the organization | one per organization; one more per flow copy that isolates org state |
| Paused run (suspension and its checkpoints) | the request that paused | the person who answers it, through `fsdev dev` or the resume route | the store's suspension and checkpoint tables | one per pause |

Facts behind each cell:

### Session

- Every session and request records the flow instance that created it, as `flowId`, next to the definition, as `flowKind`. `pe:121`; `eng/src/stores/types.ts:33-55` (`flowKind`, `flowId`). [page: "records the flow that made it"; the instance-address rules are [ref] and C-02/C-03]
- A session record carries `userId`, `orgId`, `tenantId` (when one is sent), `parentSessionId` (a session started by another session), `title`, `description`, `tags`, `metadata`, `latestRequestId`, and a `journal`. `eng/src/stores/types.ts:33-128` (the fields). [ref: reference/stores] `title`/`metadata` lookups: `reference/stores`, `pe:358-387`.
- A session belongs to one user and one organization, set at creation, and cannot move to another organization. `eng/src/context/binding-errors.ts:46-51` (doc: "Org binding is immutable for the lifetime of a session"). [page, as the owner's fact]
- Session storage keys off the tenant and the session id only; `userId` and `flowKind` are record fields, not part of the key. So inside one tenant, two users who pick one session id collide: the second create is a `409`, and a read returns the other record or a `403` where authentication is configured. `pe:393`; `eng/test/user-cell-keys.test.ts:90-94` (session key is `s1`, or `t1:s1` for tenant `t1`). [ref: reference/stores; keep off the page]
- Creating a session that already exists returns `409`. On SQLite and Postgres two creators of one id at the same time get one `201` and one `409`. `pe:403`. [ref]
- Session records written by older versions with no `flowId`, and sessions with no `orgId`, answer `409 { "error": "migration-required" }`; the one-time attribution procedure is operator work, `pe:123-254`. [ref: Moving data is B-31; the page links and states neither]
- Tenant id splits sessions only (and requests' listing); user and org state are shared across tenants. `pe:258-267`. [ref: C-17; the page links]
- Listing sessions by metadata: no server-side filter; the client filters in memory. `pe:385`. [ref: reference/stores per the sitemap's "lookups by metadata"]

### Request

- Request state is written to the store on every mutation, so a paused request can restore it on `/continue`. `apps/docs/docs/state/mutation-model.md:51`. [page: a request is a record in the store]
- The request record holds items, events, runOnce results; deleting a request removes everything stored under its id. `pe:289`. [ref]
- Items are stored one row each on SQLite and Postgres (`request_items`), appended to an NDJSON log on the filesystem store. `pe:346`; `su:101`. [ref]
- A SQLite or Postgres list of requests does not load items by default. `pe:348`. [ref]
- Retention deletes finished requests; sweep behaviour is in `pe:293-298`. [ref]

### User and org

- Each user's state is keyed by user and organization: the same user in two organizations has two user records, and what she saves in one is not there in the other. `uck:36-45` ("gives one user a different cell in each org"); `goals/user-scope/keeps-a-users-data-in-the-org-it-was-saved-in/goal.md:4` (Alice saves in Acme and reads it back there; in Globex, and for Bob in Acme, the same flow reads none). [page; answers Q3]
- The key, as asserted by the test, is `<user>:~org:<org>` (for example `alice:~org:acme`); with `isolateUserState` it gains `:<flow id>`. `uck:30-37`. The org record's key is the organization id (`acme`), `acme:<flow id>` when isolated. `uck:80-88`. [page: "keyed by the user and the organization" in words; the strings themselves [ref], they are internals a reader cannot observe by calling the API except in the store's rows]
- A missing or malformed organization throws `OrgRequiredError` rather than building a key every organization would read. `eng/src/stores/scope-keys.ts:180-185` (doc comment), `uck:100-110`. [ref]
- Where the organization comes from: a configured resolver, or the reserved `DEFAULT_ORG_ID` for an app that configures none. `pe:200`; `packages/core/src/index.ts:52` (exports `DEFAULT_ORG_ID`). [ref: C-17 and Authentication; page may say "an app with no sign-in runs in one default organization"]
- A non-zero count of sessions under the reserved id on an installation that ever authenticated is a stop; operator procedure. `pe:212-218`. [ref: B-31]
- **Isolated cells**: a flow that sets `isolateUserState` or `isolateOrgState` gets its own record per flow instance; so does an org-scoped resource with `flowIsolation: true`. `pe:125`; `uck:45-60`. [ref: reference/flows, C-02/C-03]
- Defaults on read: a field the record does not hold reads as its schema default. [ref: C-07 state-and-scopes]

### Paused runs

- A host over persisting stores holds a stop (`ctx.suspend()`) until it is answered or its deadline passes; durable execution is on by default there. `fst:307-313`; `dbd:55-64`; `goals/durable-by-default/a-local-stop-is-held-and-answered/goal.md:3` (Outcome). [page]
- Durable execution is off by default over in-memory stores, "where a suspension would be lost with the process". `fst:312-313`; `dbd:78-85`. [page; the third leg of the figure's highlighted cell]
- `durable: true` forces it on over in-memory stores (for tests); `durable: false` turns it off over persisting stores. `fst:313-317`; `dbd:66-76`, `dbd:87-96`. [ref: reference/stores or Durable execution; page names `durable` at most once, in the choosing section]
- A paused request survives a cold restart: a new process over the same on-disk store loads the earlier suspension as pending, and approving it completes the same request with the same payload. `goals/suspension/resumes-after-a-cold-restart/goal.md:3-6` (filesystem store); `goals/durable-by-default/a-local-stop-is-held-and-answered/goal.md:3` (SQLite, across `fsdev dev` restarts). [page; answers the figure's highlighter cell]
- Both SQLite and Postgres return it (the startup sweep runs over any store with an active-request registry: `packages/store-postgres/src/active-request-registry.ts:145`, `packages/engine/src/flowstate/createFlowState.ts:827-835`). The page leaves the Continue/Discard detail to Reference and the pausing page.
- A turn that was running when its server was killed shows up, after the next start, as that conversation's interrupted turn; **Continue** carries the same request id on to its answer, and **Discard** ends it for good. `goals/continue-interrupted-run/after-a-restart/goal.md:3-9` (SQLite on disk, `SIGKILL`, a fresh host). With the default thresholds the turns appear about a minute after the restart (60 s stale threshold; the goal uses 1.5 s). [page: Continue/Discard in one sentence; the minute figure [verify], from a goal's blockquote, `goal.md:15`]
- An interrupted request needs a store that supports interrupted-request recovery; SQLite does, via its active-request registry with heartbeats. `sql/README.md:75-77`. [ref]
- The page no longer states that a server can write while other processes read (WAL, `sql/README.md:47-56`); that is a Reference row.
- SQLite's registry reports not shared across processes (`sharedAcrossProcesses: false`) because it cannot tell whether the file sits on a shared volume. `sql/README.md:79`. [ref]
- **[page, confirmed in source]** `packages/engine/src/context/createExecutionContext.ts:219-225`: a host on in-memory stores refuses `ctx.suspend()`, naming in-memory stores and `durable: true`, holding nothing. The page says: on memory a run that reaches an approval stop fails at that stop and nothing is held.
- Over an in-memory store, a stop is not held: the run refuses at the stop, names the rule ("wherever stores persist") and the settings (`durable: false`, `durable: true`), records the request `failed`, and holds no suspension. `dbd:98-129`. That test uses the filesystem store with `durable: false`; the in-memory case has the same missing provider (`dbd:78-85` shows `durabilityProvider` undefined for in-memory) but no test runs a stop there. [verify for in-memory; page may say "over the in-memory store a run that stops for a person fails at the stop, unless you set `durable: true`" only if section 11 item 5 holds] [ran: not run; the claim is derived. Keep off the page unless confirmed.]
- With durable execution on, a stop with a deadline is marked expired within seconds of the deadline, but only while a server is running on that store: "its deadline fires only while a server runs on this store". `goals/durable-by-default/a-local-stop-is-held-and-answered/goal.md:3` (signal a, c). [ref: Durable execution]
- `fsdev run` over the default local store exits 0 on a stop, prints the stop's id, and says to answer it in `fsdev dev`. `goals/durable-by-default/a-local-stop-is-held-and-answered/goal.md:3` (signal a). [ref: CLI]

## 3. The three stores (and the fourth)

### Memory

- It is the default for `createFlowState` when `stores` is omitted. `fst:169-173`. [page]
- Zero configuration; fast; "gone when the process exits". `pe:32`. [page]
- Declared as `inMemoryStores()` from `@flow-state-dev/engine`. `eng/src/stores/index.ts:267`; `pe:35-40`. [page: example 1 is "nothing to write", so the page need not show it; naming it once is allowed]
- Startup says so when `stores` is omitted: `[flowstate] active profile: "default" (no stores set: the app runs in memory, and nothing persists across a restart)`. `eng/src/flowstate/createFlowState.ts:967-976`. [page: "startup says so"; the exact line [ref]]
- In production (`NODE_ENV=production`) with `stores` omitted, it warns once: sessions and requests are lost on every restart, set `stores`. `eng/src/flowstate/createFlowState.ts:978-985`. [page: one clause]
- Right for development, testing and demos. `pe:25`. [page]
- A fresh in-memory store per instance: two of them are two separate datasets. `pe:405`. [ref]
- Not durable by default for paused runs; see section 2.

### SQLite

- `@flow-state-dev/store-sqlite`; `sqliteStores({ filename })`; one file; created if it does not exist; `":memory:"` is a throwaway database. `sql/src/registry.ts:36`, `:95`; `sql/README.md:37-44`. [page: example 2]
- The root of the package exports `sqliteStores` and `createSQLiteScheduleIndex` only. `sql/src/index.ts:9-10`. The store registry factory (`createSQLiteStores`) is on `@flow-state-dev/store-sqlite/host`. `sql/src/index.ts:5-7`. [page: import `sqliteStores` from the package root] **[conflict]** `sql/README.md:15-30` imports `createSQLiteStores` from the package root; the code does not export it there. Do not copy that line.
- The adapter backs `primary` only (no `bus`). `sql/src/registry.ts:98`. [ref: reference/stores]
- Everything it stores survives a process restart, resource state and content included. `sql/README.md:83-85`. [page]
- WAL mode is on, so readers run beside the writer. `sql/README.md:47-56`. [ref; one clause on the page at most: "safe to write beside a running server"]
- Atomic compare-and-swap in the store; "Every writer against the database file". `pe:94`. [ref]
- One store fits "single server wanting concurrency-safe writes". `pe:27`, `pe:416`. [page: Choosing]
- It is what `fsdev dev` opens: `.fsdev/data/fsdev.db`, shared by `fsdev run`, `fsdev dev` and `fsdev chat`. `su:94`; `ls:5-6`, `ls:73-80`; `dt:128`. [page: one sentence; answers where a developer's data already is]
- A run in a terminal and a running `fsdev dev` have separate in-memory change buses: what the run writes is on screen the next time the page reads (a reload), not pushed. `ls:7-9`; `dt:128`. [ref: CLI, DevTool]
- Several servers on one SQLite file do not push changes to each other's open pages. `pe:340`; `pe:21`. [ref]
- SQLite is single-writer; a single node needs no further coordination for a cron tick. `sql/README.md:73`. [ref]
- Schema is created on open unless `skipSchemaInit: true`. `sql/src/registry.ts:36-41`, `sql/README.md:37-44`. [ref]
- Deleting a resource leaves a small row behind; nothing reclaims these rows. `pe:103`; `sql/README.md:107-109`. [ref]

### Postgres

- `@flow-state-dev/store-postgres`; `postgresStores({ connectionString })`; with `connectionString` omitted, it reads `FSD_DB_URL`, then `DATABASE_URL`; with neither, it throws asking for one. `pg/src/registry.ts:129-150`; `pg/src/types.ts:79-80`; `pg/README.md:38-46`. [page: example 3]
- The adapter backs `primary` and `bus`. `pg/src/registry.ts:259`. [ref]
- It needs the `pg` package alongside: `pnpm add @flow-state-dev/store-postgres pg`. `pg/README.md:14-16`. [page: install line]
- Production, multi-instance fleets, serverless with shared Postgres. `pe:28`; `pe:417-418`. [page: Choosing]
- A change one process saves reaches an open session view on another process as soon as it is saved, with nothing to configure. `pe:80`. [page, one clause: "more than one server can share it"; mechanism [ref]]
- On Vercel, `vercelPostgresStores()` from `@flow-state-dev/vercel/store` swaps in. `pe:78`; `su:96`. [ref: deployment pages; page links]
- A transaction pooler does not deliver `LISTEN` notifications; views then re-read about once a second. `pe:80`, `pe:418`. [ref]
- Atomic compare-and-swap: "Every connection to the database". `pe:95`. [ref]
- Pool size defaults to 10, set with `max`. `pg/README.md:24`; `pg/src/registry.ts:27`. [ref]

### Filesystem (the fourth store)

- `filesystemStores({ rootDir, developmentOnly: true })` from `@flow-state-dev/engine`. `eng/src/stores/index.ts:284`; `fst` and `su:92`. [ref: reference/stores; one clause on the page if the owner keeps it]
- A directory of real files: a resource at `notes/meeting` becomes `notes/meeting.md` (content) or `.json` (state), browsable and diffable. `pe:45`. [ref]
- Constructing it without `developmentOnly: true` logs a one-time warning that it is unsuitable for production load; the flag changes no behavior. `eng/src/stores/index.ts:150-161`, `:220-227`. [ref]
- Its guarantees reach one store instance only, not a second process on the same folder. `pe:93`, `pe:97`. A second store on the same directory races with the first. [ref]
- `fsdev --store filesystem` keeps a run's state as JSON files under `.fsdev/data`; single-process, so `fsdev run` and `fsdev dev` cannot use it together. `ls:27-28`, `ls:63-69`; `dt:130`. [ref: CLI]

## 4. Choosing a store

The old page's chooser, `pe:411-419`, reduced to what the sitemap asks (one machine and one file survives restarts; more than one server; serverless). Each line maps to a store.

- Local development, nothing to keep: memory (the `createFlowState` default). `pe:415`. [page]
- One machine, one file, survives restarts: SQLite. `pe:27` ("Single-server deployments wanting concurrency-safe writes"), `pe:416`; `su:94` ("Recommended for durable persistence; what `fsdev dev` uses"). [page; answers Q2]
- More than one server, or production: Postgres. `pe:417`. [page]
- Serverless or edge: Postgres through a pooled endpoint, `vercelPostgresStores()` on Vercel. `pe:418`. [ref: deployment]
- Per-environment profiles: `stores: { dev: {...}, prod: {...} }` with `defaultProfile`. The active profile is `process.env.FSD_ENV`, then `defaultProfile`, then the first declared; `NODE_ENV` is not consulted. `fst:169-185` (the profiles and `defaultProfile` at `:185`); `su:80-85`. [page: one sentence in Choosing; this is how a team keeps SQLite in dev and Postgres in prod]
- Working example: the knowledge-base example picks `dev` (filesystem under `.fsdev/data`) or `prod` (`postgresStores({})`) from whether `FSD_DB_URL` or `DATABASE_URL` is set, with the same flow either way. `kb:21-45`. [page: evidence for Q4; the example uses the filesystem store for dev, so cite only the profile switch]
- "The filesystem store is fine for very low concurrency, but its per-request event log doesn't hold up under real load — reach for SQLite." `pe:416`; `eng/src/stores/index.ts:153-158` ("O(N²) event persistence collapses under production load"). [ref]
- At high event volume, Postgres `LISTEN/NOTIFY` has a fan-out ceiling; put streaming on Redis or NATS behind the same `subscribeToEvents` interface. `pe:417`. [ref]
- Special requirements: implement the `StoreAdapter` interface. `pe:419`; `eng/src/stores/store-adapter.ts:50-66`. [ref: custom stores; page links, per the sitemap]

## 5. What a restart keeps (figure)

Per store; sessions, state, resources, paused runs. Marks: hatching on SQLite and Postgres (outlives the request), dashed outline on memory, highlighter on "paused runs".

| | Memory | SQLite | Postgres |
| --- | --- | --- | --- |
| Sessions (and their items) | gone | kept | kept |
| State (session, user, org) | gone | kept | kept |
| Resources (state and content) | gone | kept | kept |
| Paused runs | never held (`durable` is off) | kept; held and answerable after a restart | kept; held and answerable after a restart |

- Memory: "None — data is lost on restart". `pe:25`; `fst:171-172`. Paused runs: durable off by default, `fst:312-313`, `dbd:78-85`. [page]
- SQLite: sessions and records `sql/README.md:87-88`; request items `:89`; resource state `:90`; resource content `:92`; checkpoints and suspensions `:94`; suspension held across `fsdev dev` restarts, goal a/b. [page]
- Postgres: "Stores state in PostgreSQL". `pe:62`. Resource state and content persist, the same table design (`pg/src/resource-state-store.ts`, `content-store.ts`, `suspension-store.ts`, `checkpoint-store.ts`, `session-store.ts`, `user-store.ts`, `org-store.ts` all exist). Not run in this pass; the Postgres goals need a database. [verify by running only if the page claims more than "kept"; the table's "kept" rests on the adapter exposing the same stores as SQLite and `pe:114`]
- Resources are "always persisted with their scope". `pe:114`. [page]
- **[conflict]** `pe:113-117` says request state "lives for one action execution, then discarded", "ephemeral", and sequencer state "in-memory only, never persisted". `mutation-model.md:51` says request state is written to the store on every mutation so a paused request can restore it on `/continue`. The request record is a stored record, in the same tables as sessions. The page does not say request state is ephemeral. [page: a request is stored; a request's own scratch state is read only by that request] Sequencer state: [verify] not confirmed by running; keep off the page.
- A paused request restores its request state on continue. `mutation-model.md:51`. [page]
- Dashed outline for memory means "lasts one action run" in the figure vocabulary (`docs/contributing/user-docs.md:369-373`); here it means the store lasts one process. The figure brief should say what the mark is carrying; the owner/figure pass decides. [plan]

## 6. Does changing the store change your flows?

Q4's answer: no flow code changes. A flow never names a store; the app's `createFlowState` call does.

- Stores are set once, on `createFlowState`, as a map of named profiles or one adapter. Flows, blocks and actions do not take a store. `fst:169-179`; `kb:36-42` (the flow, `knowledgeFlow`, is passed to `flows` and the store profile is a separate key). [page; answers Q4]
- The CLI follows the app's config: with an `fsdev.config.ts`, `fsdev run` "resolves models through your resolver, persists to your stores", so the behaviour matches the server's. `apps/docs/docs/cli/configuration.md:17`; `apps/docs/docs/cli/agent-dev-loop.md:33`. [ref: CLI; page may say "`fsdev run` uses the same stores as your app"]
- What does change with the store, as an observer sees it:
  1. **What survives a restart** (section 5).
  2. **Whether a paused run is held** (section 2). Durable execution is on by default over a persisting store, off over memory. `fst:307-319`.
  3. **Whether another process sees your writes at once**: Postgres carries change notices between processes; the in-memory, filesystem and SQLite stores do not, so such an app runs as one process. `pe:13-21`, `pe:340`. [ref: reference/stores; page: one clause]
  4. **How far a concurrent-write guarantee reaches**: SQLite, every writer to the file; Postgres, every connection; filesystem, one store instance; memory, this process. `pe:90-97`. [ref]
  [page: items 1 and 2 only]
- Every adapter implements the same `StoreRegistry`; the engine ships conformance suites a custom store runs: request, scope, resource, lease, wake, trace, retention, session-stream, parked-gate. `eng/src/stores/testing/` (files: `request-store-conformance.ts`, `scope-store-conformance.ts`, `resource-store-conformance.ts`, `lease-store-conformance.ts`, `wake-store-conformance.ts`, ...); `pe:285` (`createWakeStoreConformanceTests` from `@flow-state-dev/engine/testing`). [ref: reference/stores]
- A store you pass as a `StoreRegistry` yourself must set `bus` to use your own; the engine wraps request and session stores so every write publishes. `pe:342`. [ref]
- Moving existing data between stores is not covered by the framework as a call; B-31 owns it. Only the operator procedures for attributing owners and organizations are documented, `pe:141-254`. [ref: B-31]
- The Postgres adapter and the SQLite adapter add nullable columns on open, with an index, and never backfill: `flow_id`, `tenant_id`, `org_id`. `pe:141`, `pe:267`. Upgrading an existing database needs no manual step for `tenant_id`. [ref]

## 7. What it gets you (each point something observable)

- Data that outlives the process: a session, its state and its resources are there after a restart on SQLite or Postgres. Sections 2 and 5. [page]
- Paused runs that wait for a person: a stop is held across a restart until answered, and a turn killed mid-run is offered back as Continue or Discard. Section 2. [page]
- A per-user, per-organization record: a user who works in two organizations has two user records, so a block never filters by organization. `uck:36-45`; goal user-scope. [page]
- One line to change: the same flows run on another store by changing `stores`. Section 6. [page]
- Warns when you forgot: a production app with no `stores` warns that it is in memory. `createFlowState.ts:978-985`. [page: one clause]
- Safe concurrent writes on SQLite and Postgres, reaching every writer. `pe:94-95`. [ref]

## 8. How it fits with the others

- State and scopes (C-07): state persists in these records; the scope decides which record. `pe:113`, and see section 2. [page: link]
- Resources: a resource's `scope` decides where it persists; a resource persists with its scope. `pe:114`. [page: link]
- Sessions, items and streaming (C-06): items are the session's accumulated log and live with the session; the session stream reads the store when a change notice arrives. `pe:7`, `pe:13`. [page: link; mechanism [ref]]
- Tenant isolation (C-17): a tenant id splits sessions only. `pe:258-267`. [page: link only, per the sitemap]
- Tenancy and where `userId`/`orgId` come from: C-17 and Authentication, `pe:200`. [page: link]
- Durable execution (suspend, resume, wakes): its own advanced page, `apps/docs/docs/advanced/durable-execution.md` (referenced from `pe:11`, `pe:285`). [page: link; this page states only that durable execution is on by default over a persisting store]
- Moving data: B-31. [page: link]
- What a store must guarantee, custom stores, lookups by metadata: `reference/stores`. [page: link]

## 9. Examples (the page's one app; each one idea)

Per the sitemap: the default needs nothing written; SQLite and Postgres in `stores`. Every call below exists as written.

1. **The default: nothing to write.** `createFlowState({ flows: [support] })` with `stores` omitted runs in memory, `fst:169-173`. The page can show the config with no `stores` key to make the absence visible; this is a one-line example or none. Flows are a list, `flows?: readonly FlowInstance[]`; the old page's `flows: { myFlow }` record is wrong in type (see `how-it-fits-together.facts.md` for the same note). Type-check against `fst`.
2. **SQLite.** `src/server.ts` (the app's `createFlowState` call): `import { sqliteStores } from "@flow-state-dev/store-sqlite";` then `stores: sqliteStores({ filename: "./data/support.db" })`. `sql/src/registry.ts:95`, `sql/src/index.ts:9`; short form `fst:169-179`. `filename` is the only required option, `sql/src/registry.ts:36`. The directory must exist: better-sqlite3 does not create parent directories (`ls:67-68` creates `.fsdev/data` itself first). [page: one clause under the example is fine: "create the folder first"] [verify: the comment at `ls:67` is in the CLI, not the adapter's docs; confirm by running before writing the clause]
3. **Postgres.** `import { postgresStores } from "@flow-state-dev/store-postgres";` then `stores: postgresStores({ connectionString: process.env.FSD_DB_URL })`; or `postgresStores({})` to read `FSD_DB_URL` then `DATABASE_URL`. `pg/src/registry.ts:256`, `:129-130`; `pg/README.md:38-46`; `pe:64-76`. Add `pg` to the install line.
4. (Choosing, optional, one line each.) Profiles: `stores: { dev: sqlite..., prod: postgres... }` needs `{ primary: adapter }` per profile and `defaultProfile`; see `kb:36-42` for the shape (`dev: { primary: ... }`). Profile selection: `FSD_ENV` beats `defaultProfile`. `fst:169-185` (the profiles and `defaultProfile` at `:185`). [page: only if the owner keeps profiles on the page]
- Type-check note for pass 4: `stores?: StoreAdapter | StoresConfig`, `fst:178`; `StoresConfig = Record<string, CapabilitySlotMap>`, `eng/src/stores/store-adapter.ts:43`; `CapabilitySlotMap = { primary: StoreAdapter; bus?; blobs? }`, `store-adapter.ts:29-33`. `defaultProfile?: string`, `fst:185`.

## 10. Contradictions the page must not copy

1. **`pe:11`: `blobs` has "no backing store" in Phase 1.** The code ships one (section 1). Also `pe:11` mentions "Phase 1" and `queue`/`scheduler` slots; the slot map in code has `primary`, `bus`, `blobs` only (`store-adapter.ts:29-33`). Do not mention slots on the page.
2. **`pe:113-117`: request scope "ephemeral" / "discarded".** The request is a stored record (`mutation-model.md:51`; `eng/test/context.test.ts:60-91` shows the state on the record for the request id). The sibling sheet for State and scopes flags the same line.
3. **`sql/README.md:15-30`**: imports `createSQLiteStores` from the package root; only `sqliteStores` and `createSQLiteScheduleIndex` are exported there (`sql/src/index.ts:9-10`).
4. **Old examples use `stores: { default: { primary: ... } }` and `flows: { myFlow }`.** The first is valid, the second is not the type (`flows` is a list). Use the short store form and a list.
5. **`pe:25`** lists the filesystem store as "Local development with persistence, single-server deployments". The code warns it is unsuitable for production load, `eng/src/stores/index.ts:150-161`, and `pe:416` agrees it "doesn't hold up under real load". Do not recommend it for a server.
6. **`su:94`** says SQLite is "what `fsdev dev` uses". True only with no `fsdev.config.*`; with an app config, `fsdev dev` uses the app's stores and refuses `--store`. `ls:14-15`, `ls:42-52`. The page's "what `fsdev dev` uses" sentence needs the qualifier "when you have no config".
7. **`pe:62`** "Stores state in PostgreSQL with LISTEN/NOTIFY for cross-process live tail" is right; `pe:28` says the same. `vercelPostgresStores()` does not listen (`pe:80`), so the `LISTEN/NOTIFY` claim does not carry to Vercel.
8. **`pe:10`**: the old page says "The server ships with an in-memory store by default" and "Swap it for the filesystem, SQLite, or Postgres adapter when you need data to survive restarts". True of `createFlowState`; not of `fsdev dev` with no config (item 0.2).
9. **`pe:267`** adds "Persistent adapters (SQLite, Postgres) add a nullable `tenant_id` column". The `flow_id` and `org_id` columns are added the same way (`pe:141`, `pe:224`, `pe:248`). The filesystem and in-memory stores keep the fields on each record. `pe:172`.

## 11. Facts not confirmed by running

No code was run in this pass; every statement above comes from a cited test, goal, doc comment or exported signature.

1. Postgres keeps every part of the figure's table (rests on the adapter exposing the same stores as SQLite and `pe:114`; goals need a database). [verify before the page says more than "kept"]
2. SQLite creates the file but not its folder. Cited only from `ls:67` (the CLI creating `.fsdev/data` first). [verify before the page tells the reader to create the folder]
3. The Postgres adapter's trace store is in memory (`pg/src/registry.ts:236`). Read, not run. Keep off the page.
4. Interrupted turns appear "about a minute" after a restart with default thresholds: from the goal's note (`goals/continue-interrupted-run/after-a-restart/goal.md:15`), not seen running. Keep off the page unless confirmed.
5. Over the in-memory store a stop refuses at the stop. The refusing test uses the filesystem store with `durable: false`, `dbd:98-129`; the in-memory store's missing provider is shown at `dbd:78-85`. Combine the two only after a run.
6. `items` transient in production (`pe:115`). Keep off the page.

## 12. Cold-read answer key (for pass 2, from this sheet)

1. You restart a server built with `createFlowState` and no `stores`: **everything** is gone: sessions and their items, session, user and org state, resources, and any run that was paused for a person (which was never held). A project run with `fsdev dev` and no config is on SQLite and keeps all of it (item 0.2; sections 2, 3, 5).
2. One machine, one file, survives restarts: **SQLite** (`sqliteStores({ filename })`, `@flow-state-dev/store-sqlite`). `pe:416`; `su:94`.
3. A user's state belongs to **that user's record in that organization**, keyed by user and organization; Alice's record in Acme and her record in Globex are two records. `uck:36-45`; goal user-scope. Org state is a separate record keyed by the organization alone.
4. Changing the store: **no flow code changes**; `stores` on `createFlowState` is the only line. What changes is what survives a restart and whether a paused run is held. Section 6.
5. Edge: a paused run (approval) on the default `fsdev dev` store, then the server restarts: it is **still held**; answer it after the restart, and the same request completes. Goal durable-by-default b; goal suspension.
6. Edge: a production deploy that forgot `stores`: it **runs, in memory, and warns once**; sessions and requests are lost on every restart. `createFlowState.ts:978-985`.
7. Edge: Alice uses the app in Acme and in Globex: **two user records**; what she saves in Acme is not read in Globex. Goal user-scope.
8. Edge: two servers behind a load balancer: **Postgres**; SQLite on one file does not push one server's changes to the other's open pages. `pe:340`, `pe:417`.

## 13. Where the word budget goes (1,000 words, sitemap C-14)

- Opening and what gets stored: about 130 words.
- Memory, SQLite, Postgres, with three short examples: about 280 words and about 20 lines of code.
- Choosing, who owns a record, what a restart keeps (with the figure): about 330 words.
- What it gets you, how it fits with the others, Next: about 200 words.
- Every row marked **[ref]** goes to `reference/stores`: adapter options and slots, the filesystem layout, trace retention, concurrency by store, the bus, deletion markers, session id and tenant rules, retention, custom stores and their conformance suites, wakes. Moving data goes to B-31; tenant isolation to C-17.
