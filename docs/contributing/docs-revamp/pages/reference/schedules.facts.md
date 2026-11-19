# Facts for Schedules (R-33, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests and `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. Where a fact comes from reading the implementation rather than a test or an exported doc comment, it is marked **[source]**; where a pinned test shows it, **[test]**. **[ran]** marks a thing I ran this session. Nothing was run against a deployed project.

Abbreviations (paths from the repo root):

- `st` = `packages/core/src/types/schedules.ts` (the public `schedules` types and validators)
- `rt` = `packages/engine/src/transports/scheduled/routes.ts` (the dispatch and list handlers)
- `ad` = `packages/engine/src/transports/scheduled/createScheduledEndpointAdapter.ts`
- `stm` = `packages/engine/src/transports/scheduled/scheduledTime.ts`
- `tick` = `packages/engine/src/execution/schedule-tick.ts`
- `ls` = `packages/engine/src/execution/local-scheduler.ts`
- `cfs` = `packages/engine/src/flowstate/createFlowState.ts`
- `fst` = `packages/engine/src/flowstate/types.ts`
- `dsc` = `packages/scheduled/src/defineScheduleCollection.ts`
- `rsr` = `packages/scheduled/src/createResourceCollectionScheduleResolver.ts`
- `sidx` = `packages/scheduled/src/scheduleIndex.ts`
- `vs` = `packages/vercel/src/scheduler.ts`
- `sq` = `packages/store-sqlite/src/schedule-index.ts`; `pgx` = `packages/store-postgres/src/schedule-index.ts`
- `goal` = `goals/scheduled-work/fires-with-no-outside-cron/goal.md` (and its `app.mts`, the one example)
- Tests: `adt` = `packages/engine/test/transports/scheduled/adapter.test.ts`, `opt` = `.../scheduled/once-per-time.test.ts`, `bi` = `packages/engine/test/transports/scheduled-builtin.test.ts`, `lst` = `packages/engine/test/flowstate/local-scheduler.test.ts`, `sct` = `packages/engine/test/flowstate/scheduler.test.ts`, `ftp` = `packages/engine/test/flowstate/schedule-tick-failure-paths.test.ts`, `vst` = `packages/vercel/test/scheduler.test.ts`, `dsct` = `packages/scheduled/test/define-schedule-collection.test.ts`, `rsrt` = `packages/scheduled/test/resource-collection-resolver.test.ts`, `sval` = `packages/core/test/schedules-validation.test.ts`, `cell` = `packages/integration-tests/src/scenarios/schedule-cell.test.ts`, `xp` = `packages/integration-tests/src/scenarios/schedule-tick-across-processes.test.ts`.

## What the page is

A Reference page for the pieces that make a flow's `schedules` fire: the fields a schedule has, the endpoint every fire is POSTed to (the dispatch endpoint, so named on the page), the schedule index a tick reads, and whose run a fired schedule is. It is lookup tables, no narrative. Two lookups it answers by name: "What calls the tick?" and "How is a missed tick handled?"

Imports the page's rows name:

- `defineScheduleBinding`, `defineFlow`, `formatScheduleId`, types `ScheduleConfig`, `SchedulesConfig`: `@flow-state-dev/core` and `@flow-state-dev/core/types` (`st:499`, `st:276`; the `schedules` option on `defineFlow` is shown in `goal`'s `app.mts` and `adt`).
- `defineScheduleCollection`, `createResourceCollectionScheduleResolver`, `defaultParseScheduleId`, `ScheduleIndex`, `ScheduleIndexEntry`, `parseNextFireAt`, `createBadCronWarner`: `@flow-state-dev/scheduled` (`packages/scheduled/src/index.ts:12-33`).
- `createSQLiteScheduleIndex`, `sqliteScheduleIndex`: `@flow-state-dev/store-sqlite` (`packages/store-sqlite/src/index.ts:11`). `createPostgresScheduleIndex`: `@flow-state-dev/store-postgres` (`packages/store-postgres/src/index.ts:11`).
- `vercelScheduler`, types `VercelScheduler`, `VercelSchedulerOptions`: `@flow-state-dev/vercel` (`packages/vercel/src/index.ts:11-12`).
- `createFlowState({ scheduler })`, `SchedulerAdapter`, `ScheduleTicker`, `ScheduleTickReport`: `@flow-state-dev/engine` and `@flow-state-dev/engine/host` (`fst:144-146`, `fst:428`, `packages/engine/src/host.ts:117-119`).
- `SCHEDULED_TRANSPORT_SOURCE`: `@flow-state-dev/engine` (`packages/engine/src/index.ts:50`).

## Table 1: Schedule fields

There are two shapes, and the page should not blend them. A **static** schedule is written in the flow. A **stored** schedule is a resource in a schedule collection, mapped to a block by the resolver.

### Static schedule (`schedules.static[id]`)

`ScheduleConfig` is the shared action core plus the schedule fields (`st:141`). **[source]/doc comment**

| Field | Type | Default / rule | Cite |
| --- | --- | --- | --- |
| `block` | a block of any kind | Required. A schedule with no `block` is refused at `defineFlow` time. The handler is inline; it needs no entry in `flow.actions` and a scheduled handler is not reachable through the action surface or MCP | `st:132-140`, `st:432-437`; `sval:97`, `sval:282`, `sval:293` |
| `cron` | string | Required. Exactly five whitespace-separated fields: minute hour day-of-month month day-of-week. A cron that does not parse, or has other than five fields, throws when the flow is defined | `st:147`, `st:365-367`, `st:406-411`, `st:422-430`; `sval:54`, `sval:67`, `sval:268` |
| `input` | any value, or `(ctx) => value` | Optional. A static value is checked against the block's `inputSchema` (or the binding's `inputSchema`) at definition. A function is called at fire time with `{ scheduleId, cron, nominalFireTime, principal, flowKind, origin }` and is not called at definition. With none, the block receives `{}` | `st:108-123`, `st:155`, `st:439-450`; `rt:235-253`; `sval:108`, `sval:125`, `sval:141` |
| `principal` | `{ userId, orgId? }` | Optional. Who the run is for. Row in Table 4 | `st:178` |
| `timezone` | IANA zone string | Optional, `"UTC"` when omitted. An unknown zone throws at definition (static) or answers `400 invalid_schedule` (dynamic) | `st:185`, `st:413-420`; `sval:78`; `adt:288` |
| `onOverlap` | `"skip"` or `"allow"` | Default `"skip"`. Any other value throws at definition (the page says only that; it does not name `"queue"`) | `st:198`, `st:452-461`; `sval:152` |
| `description` | string | Optional free text. Shown in the listing | `st:204`; `rt:330-337`, `rt:385-392` |
| `enabled` | boolean | Default `true`. A disabled static schedule is not ticked, shows in the listing with `enabled: false`, and its dispatch answers `404 schedule_not_found` | `st:212`; `tick:106`; `rt:142-144`, `rt:391`; `adt:480` |
| Action-core fields | `durable`, `tokenBudget`, `concurrency`, `inputSchema`, `onCompleted`, `onErrored`, `userMessage`, `taskOf`, `autoResume` | Inherited from the shared core (`ScheduleConfig = ActionCore & {...}`) | `st:141`; `packages/core/src/types/flow.ts:198-257` |

- A schedule's **id** is its key in `schedules.static`: lowercase letters, digits and dashes, starting with a letter or digit, at most 64 characters. Anything else throws at definition. **[test]** `st:357`, `st:399-404`; `sval:43`.
- A dynamic id (from the resolver) skips that pattern. It may hold `/` and `:`; the dispatch route accepts the characters `A-Z a-z 0-9 - _ . ! ~ * ' ( ) % : /` and answers `400 invalid_schedule_id` for anything else. **[source]** `rt:32-40`, `rt:56-58`; **[test]** `adt:123`, `sval:177`.
- `defineScheduleBinding(config)` returns its argument; a plain object works too. `st:491-501`; `sval:241`.
- Static entries are validated when the flow is defined. A resolver is not run then. `st:475-489`; `sval:229`, `sval:320`.

`SchedulesConfig` (the flow's `schedules` option) holds three keys, all optional: `static` (the map above), `resolve(scheduleId, ctx)` (dynamic lookup, called when `static[id]` is absent; `null` answers 404), and `index` (the schedule index the tick reads, Table 3). `st:221-248`. A static id wins over the resolver for the same id. **[test]** `adt:571`.

### Stored schedule (a resource in a schedule collection)

The row's state shape, from `defineScheduleCollection` (`dsc:170-201`, exported as `ScheduleCollectionState`):

| Field | Type | Default / rule |
| --- | --- | --- |
| `cron` | string | Required. Not validated on write (see the cron row below) |
| `kind` | string | Required. Names which block runs. A block cannot be stored, so the resolver maps `kind` to a block through the `blocks` map you give `createResourceCollectionScheduleResolver`. A `kind` with no entry in `blocks` resolves to nothing (`404`) (`dsc:164-169`; `rsr:55-64`, `rsr:146-149`; `rsrt:136`) |
| `input` | any JSON value | Optional |
| `timezone` | IANA zone string | Optional, UTC when omitted |
| `onOverlap` | `"skip"` or `"allow"` | Optional, same meaning as above |
| `description` | string | Optional |
| `enabled` | boolean | Default `true`. `false` removes the row from the index, so it stops firing without being deleted (`dsc:284-287`; `dsct:111`) |
| `orgId` | string | Optional on the schema; **not set by the caller**. `create` writes the creating run's organization into it; an update that omits it keeps it; a write naming another organization throws (`dsc:172-186`, `dsc:253-257`; `dsct:228`, `dsct:247`, `cell:333`, `cell:357`) |
| `metadata` | record of unknown | Optional. Kept with the row and never read by the resolver, the index or dispatch (`dsc:194-200`) |

Only the row's fields above map onto a fired schedule: the resolver copies `cron`, `input`, `timezone`, `onOverlap` and `description`, and sets `principal` from the id (`rsr:161-175`; `rsrt:222`). `enabled: false` makes it resolve to nothing. There is no `name` field: the row's key is its name.

Cron on write: the collection's `create` does **not** validate `cron` or `timezone` (the schema is a plain string; `dsc:187-190`). What happens to a bad one:

- Unparseable cron (`"not a cron"`) or an unknown time zone: the row is saved, a warning is logged (`[flow-state/scheduled] ... failed to parse cron`), and no index row is written, so it never fires from the tick. **[test]** `dsct:436`; **[source]** `dsc:396-402`; **[ran]** `parseNextFireAt("* * * * *", "Nope/Zone")` returns `null`.
- A cron that parses but is not five fields (a sixth field is read as seconds): **[ran]** `parseNextFireAt("* * * * * *")` returns a time, so the row is indexed and the tick sends it. The dispatch endpoint refuses each fire `400 invalid_schedule`, and the tick logs the 400. It never runs. **[source]** `st:365-367`, `st:406-411`, `rt:146-158`, `tick:170-175`. Check the cron before writing it; `isFiveFieldCron` and `isKnownTimeZone` are exported from `@flow-state-dev/core/types` for that (`st:365`, `st:373`).

## Table 2: The dispatch endpoint

Every fire, from every path, is a POST to this one endpoint. The router mounts it on every app, with no adapter line and no per-flow setup. **[test]** `bi:66`; `goal` outcome; **[source]** `ad:446-460`.

| Route | Purpose | Cite |
| --- | --- | --- |
| `POST /api/flows/:flowKind/schedules/*scheduleId/dispatch` | Fire one schedule | `ad:480-483` |
| `GET /api/flows/:flowKind/schedules` | List a flow's static schedules | `ad:484-488` |

- Both routes live under `/api/flows` only. **[source]** `tick:49`, `ad:480`. An app that serves the flow API under another prefix still ticks locally; an outside cron aimed at the other prefix gets a 404. (This is stated on the mount path; no test pins the other-prefix case, so say only "the routes are under `/api/flows`".)
- A flow that is unknown, or registered with no `schedules`, answers both routes `404 { "error": "flow_not_found" }`, byte for byte alike, before any principal resolver runs. A flow registered after the router was built is still routed. **[test]** `bi:94`, `bi:106`; `goal` signal f. **[source]** `rt:404-423`.
- An app adapter that registers one of those two paths is refused at startup. **[test]** `bi:131`.
- A dynamic id goes in the URL as one encoded segment: `encodeURIComponent(formatScheduleId(orgId, userId, key))`. `formatScheduleId` joins `<orgId>/<userId>/<key>`, each part URL-encoded. **[source]** `st:266-278`; **[test]** `packages/scheduled/test/dispatch-id-contract.test.ts:23`, `cell:199`, `cell:224`.

### Request

- Method and path as above. Header: `Authorization: Bearer <secret>` when the caller has one. The tick sends `CRON_SECRET` from the environment, or the secret `vercelScheduler` was given, and omits the header when there is none. **[source]** `tick:194-213`, `cfs:1343-1366`; **[test]** `vst:37`, `packages/vercel/test/schedule-dispatch-org.test.ts:139`.
- The call is authenticated like any inbound request: the flow's `authentication.resolvePrincipal` runs with `source: "scheduled"`. Wire this on the Authentication page; the endpoint only calls it. The listing runs the resolver too. **[source]** `rt:68-96`, `rt:356-379`; **[test]** `adt:306`, `adt:553`; existing page `apps/docs/docs/server/scheduled.md:318-348`. `createBearerSecretPrincipalResolver` (`@flow-state-dev/engine`) is the helper for a shared secret: it returns `null` when the header is absent, throws 401 on a wrong secret (`packages/engine/src/transports/auth/createBearerSecretPrincipalResolver.ts:1-60`).
- Body: optional JSON `{ "nominalFireTime": "<ISO-8601>" }`. An empty or unparseable body counts as no time. **[test]** `adt:699`, `adt:719`. The tick always sends the time. `tick:211`.
- `idempotencyKey` in the body is refused `400 idempotency_key_removed`. **[test]** `opt:190`.

### Which scheduled time a fire counts against

| Fire | Counts against | Cite |
| --- | --- | --- |
| Carries `nominalFireTime` | The scheduled time of the cron within 5 seconds of it. A time near no scheduled time: `400 not_a_scheduled_time`. A scheduled time not yet due (more than 5 s ahead): `400 not_yet_due`. A value that is not an ISO time: `400 invalid_nominal_fire_time` | `stm:23-28`, `stm:60-105`; `opt:130`, `opt:137`, `opt:145` |
| No time | The latest scheduled time already due, counting one up to 5 s early as due. Never the next one | `stm:60-65`; `opt:159`; `packages/engine/test/transports/scheduled/scheduled-time.test.ts:14` |
| A carried time more than one period behind the latest due time | `200 { status: "duplicate", reason: "stale", scheduleId, nominalFireTime }`, nothing runs, a warning is logged on the server. A scheduler that sends a fixed time hits this; send no body instead | `rt:209-219`; `opt:171` |

### Answers

| Status | Body | When | Cite |
| --- | --- | --- | --- |
| `202` | `{ status: "accepted", scheduleId, origin, requestId }` | Accepted and started. It does not say the run finished; errors after that are on the run's request record, not in this response | `rt:322-327` |
| `200` | `{ status: "duplicate", scheduleId, nominalFireTime }` | That time already fired, or a later time already did | `rt:225-227`; `opt:88`, `opt:114` |
| `200` | `{ status: "duplicate", reason: "stale", ... }` | Stale carried time (above) | `rt:218` |
| `200` | `{ status: "skipped", reason: "in_flight", requestId }` | `onOverlap: "skip"` and a run of the same schedule of the same flow instance is still active; or the flow's concurrency policy refused the dispatch | `rt:163-176`, `rt:288-296`, `rt:306-313`; `adt:354`, `adt:643` |
| `400` | `{ error: "invalid_schedule_id" }` | Id has a character outside the dynamic pattern | `rt:56-58`; `adt:123` |
| `400` | `{ error: "invalid_schedule", message }` | The resolved or static config fails validation (not five-field cron, unknown time zone, no block, bad `onOverlap`, bad input shape) | `rt:146-158`; `adt:267`, `adt:288` |
| `400` | `{ error: "not_a_scheduled_time" \| "not_yet_due" \| "invalid_nominal_fire_time", message }` | See the time table | `rt:205-207` |
| `400` | `{ error: "idempotency_key_removed", message }` | The body has `idempotencyKey` | `rt:100-107` |
| `401` | `{ error: "unauthorized", message }` | The principal resolver threw `PrincipalResolutionError` | `rt:88-96`; `adt:306` |
| `404` | `{ error: "flow_not_found" }` | Unknown flow, or a flow with no `schedules` | `rt:60-63` |
| `404` | `{ error: "schedule_not_found" }` | No static entry, the resolver returned `null`, or `enabled: false` | `rt:142-144`; `adt:145`, `adt:227` |
| `500` | `{ error: "resolver_failed", message }` | `schedules.resolve` threw | `rt:134-139`; `adt:244` |
| `500` | `{ error: "dispatch_failed", message }` | The `input` function threw | `rt:248-253` |
| `503` | `{ error: "flow_unregistered" \| "dispatch_failed", message }` | `flow_unregistered`: `host.dispatch` threw, the flow was unregistered between the lookup and the dispatch (`rt:284-300`, `adt:604`). `dispatch_failed`: acceptance failed for another reason, for example a lease backend that did not answer (`rt:312-319`, `adt:675`). Neither is cached, so a retry of the time runs | `rt:298-301`, `rt:316-319`; `adt:604`, `adt:675` |

A fire that is not admitted (an overlap skip, a concurrency refusal, a `500` after the time was claimed, a `503`) gives its time back, so a retry of that time still runs, unless a later time was claimed in between. **[source]** `rt:228-233`, `rt:9-15`; **[test]** `adt:643`, `adt:675`. The existing page's `405` for a wrong method has no pin in the endpoint's code or tests: leave it out.

### Once per scheduled time

- Each scheduled time of a schedule fires at most once, across retries, hosts and restarts. One record per schedule keeps the latest time that fired, and a fire for that time or an earlier one answers `duplicate`. **[test]** `opt:88` (two hosts, one fire: `[200, 202]`), `opt:98` (after a restart), `opt:114` (an earlier time), `opt:123` (a late retry of the previous time, then the latest, both run).
- The record is a floor whatever the cron: after a cron or time zone edit, a time at or before the last fired one is still a `duplicate`. **[test]** `packages/engine/test/transports/scheduled/scheduled-time.test.ts:38`.
- It holds across processes on a store with compare-and-set across processes (SQLite, Postgres). On the memory store, and the filesystem store, it holds within one process only. **[source]** `stm:12-17`; **[test]** `goals/scheduled-work/recurring-work-files-a-task/goal.md` leg b (two OS processes over one SQLite file file one task).
- The overlap check is best effort: two near-simultaneous ticks can both pass it; the once-per-time record then lets one fire. **[source]** `rt:160-163`.
- `onOverlap` and the action's `concurrency` policy are separate settings; a dispatch refused by a concurrency `reject` also answers `200 skipped`. `onOverlap: "allow"` skips only the schedule's own in-flight check. **[source]** `rt:163`, `rt:288-313`, `packages/core/src/types/flow.ts:240-248`.
- A scheduled run's `source` is `"scheduled"`, and its request metadata carries `schedule: { scheduleId, origin, cron, nominalFireTime, dispatchedAt, timezone }`. **[source]** `rt:255-281`; **[test]** `adt:159`, `adt:186`.

### The listing

`GET /api/flows/:flowKind/schedules` answers `200` with:

```json
{ "static": [{ "id": "...", "cron": "...", "action": "<handler block name>", "timezone": "UTC", "description": "...", "enabled": true }],
  "dynamic": { "provided": true } }
```

`dynamic.provided` is `true` when the flow has a `resolve` hook. It lists static schedules only; dynamic ones are not enumerated. It needs the same principal as dispatch (`401` otherwise). `action` is the handler block's name. **[source]** `rt:330-402`; **[test]** `adt:509`, `adt:534`, `adt:553`. A disabled static schedule appears with `enabled: false` (`rt:391`).

### What calls the tick? (lookup)

The "tick" is the one routine that finds what is due and POSTs each fire to the endpoint above. One tick covers every schedule of every flow: each enabled static schedule, and each due entry of each flow's `schedules.index`. **[source]** `tick:1-27`, `tick:93-186`; **[test]** `sct:69`, `sct:122`.

What runs it is the `scheduler` option of `createFlowState` (`fst:419-428`):

| `scheduler` | What runs the tick | Cite |
| --- | --- | --- |
| Omitted | The built-in local cron: every minute, in a process that serves requests. Starts when a router is built (`ready()`, `getRouter()`, a server) or a job queue starts processing, and a registered flow declares a static schedule or a `schedules.index`. Dispatches through the app's own router in-process | `fst:419-428`; `cfs:1343-1380`, `cfs:1404-1430`; `lst:73`, `lst:85`, `lst:121` |
| A `SchedulerAdapter` | The adapter. `createFlowState` calls its `start(ticker)` once; `ticker.tick({ baseUrl?, secret? })` fires what is due; `dispose()` calls the handle's `stop()` first. With `baseUrl`, each fire is its own network request to that deployment | `fst:122-150`; `cfs:424-433`, `cfs:494-499`, `cfs:1343-1366` |
| `false` | Nothing. The app fires its own schedules (an outside cron POSTing the endpoint) | `fst:419-428`; `lst:146` |
| `vercelScheduler()` | One Vercel Cron entry calling the route (below) | `vs:1-17` |

Local cron details:

- **One process ticks across a deployment.** The local cron holds a lease in the store (`stores.leases`) and only the holder ticks. Two processes over one shared store tick once between them. A holder that is disposed hands over at once; one that crashes hands over within three minutes. **[test]** `lst:194`, `lst:206`, `lst:222`, `lst:250`; `xp:129`; `goal` signals b, c. **[source]** `ls:1-19`.
- **Where it does not run.** A process that only resolves the runtime (`fsdev run`, `fsdev chat`, `fsdev block`) never ticks, so a schedule written under `fsdev run` fires only once a server runs. **[test]** `lst:96`, `lst:106`; `goal` `cli:fires-nothing`.
- **A job-queue worker ticks.** In a `process-only` job-queue process that builds no router, the tick runs and the fires are enqueued through the queue's runner, so they get the queue's retries and survive a worker crash. In `enqueue-only` or with `scheduler: false` on the web process, only the worker claims. **[test]** `lst:155`; `goal` run 4 (`queue:worker-ticks`). **[source]** `cfs:1384-1397`.
- **Warnings.** In production, on in-memory or filesystem stores (whose lease cannot keep a second server from ticking), it logs once: "run one server, or use SQLite or Postgres stores." On Vercel with the local default, it logs once to pass `vercelScheduler()`. **[test]** `lst:316`, `lst:328`, `lst:351`; none outside production or with no schedules, `lst:338`.
- **A flow whose `schedules` has only `resolve` and no `index`** starts fine and is never ticked: nothing hands the tick its schedules, so its fires must come from an outside caller. **[test]** `lst:305`; **[source]** `tick:216-220`.
- A flow that declares `schedules` needs no adapter: `createFlowState` starts (`lst:298`).

#### Vercel (`vercelScheduler`)

| Item | Rule | Cite |
| --- | --- | --- |
| Setup | `createFlowState({ scheduler })` with `vercelScheduler()`, and its `route` exported as the `GET` of one route: `export const GET = scheduler.route` | `vs:1-17`, `vs:31-40` |
| `vercel.json` | One cron entry calling that route. Its cadence sets only how often the tick runs; due times come from each schedule's `cron`. Use a once-a-minute cadence for minute-level crons | `vs:1-17`; existing guide `apps/docs/guides/scheduled-vercel-cron.md:130-137`, `:167` (that guide still shows removed helpers; take only the `vercel.json` shape) |
| `secret` option | Default `process.env.CRON_SECRET`, read on each call. Each fire the tick sends carries the same secret | `vs:21-29`; `vst:104` |
| Base URL | The origin of the cron request, so each fire is its own function invocation on that deployment | `vs:7-11`, `vs:61`; `vst:37` |
| Answers | `200 { dispatched: <count of fires sent> }`; `401` for a missing or wrong secret, and for every call when no secret is configured; `500` when the tick rejects (a schedule index's claim threw, so the next beat retries) or when the scheduler was never passed to `createFlowState` | `vs:33-39`, `vs:54-67`; `vst:49`, `vst:64`, `vst:75`, `vst:86`, `vst:95` |
| Relay | The route does not relay the endpoint's answers (`202`, `duplicate`, `skipped`); a fire answered with an error status is logged | `vs:62`; `tick:169-176`; `ftp:87` |

### How is a missed tick handled? (lookup)

- A tick fires each schedule once, for the **latest** time it missed. Earlier missed times are dropped; there is no burst after an outage and no backfill. **[test]** `sct:99` (a `*/5` schedule down for 23 minutes fires 09:20 once, not 09:05, 09:10, 09:15); `xp:98` (static and dynamic after downtime, once each); `goal` signal c. **[source]** `tick:15-17`.
- A tick that runs again within the same minute sends nothing new: the tick keeps one app-wide "last tick" record and a schedule fires only for a time after it. **[test]** `sct:88`. **[source]** `tick:18-20`, `tick:105-108`.
- On a first tick with no record, it looks back one interval (one minute), so a schedule added today does not fire a time long past. **[test]** `sct:111`.
- A fire the tick sends and the endpoint refuses, or one that throws, is **not retried**: delivery is at most once. It is logged naming flow, schedule and status; `202` and `200 duplicate` are not logged. **[test]** `ftp:87`, `ftp:101`; **[source]** `tick:25-26`, `tick:165-182`.
- A claim of the schedule index that fails: the tick still fires the static schedules and every healthy index, then rejects. A host's cron route answers `500` and the next beat retries, with the unclaimed schedules still pending. A claim that does not answer within half a beat (30 seconds at the default one-minute interval, `SCHEDULE_TICK_INTERVAL_MS = 60_000`, `tick:35`, `tick:116-118`) counts as failed; entries it advanced after that are logged as not fired and wait for their next time. The page says 30 seconds, not "beat". **[test]** `ftp:27`, `ftp:49`, `ftp:69`, `sct:167`; `vst:75`. **[source]** `tick:116-131`.
- A retry of a missed time (from an outside scheduler) runs only while no later time has fired. **[test]** `opt:114`, `opt:123`.
- The finest cadence is one minute (five-field cron, tick every minute). **[source]** `tick:34-35`.

## Table 3: The schedule index

The index is a derived list of each stored schedule's next fire time. The tick claims what is due from it. The schedule collection stays the source of truth. `sidx:1-51`.

Wiring: pass the index to `defineScheduleCollection({ pattern, index })` (collection writes keep it current) **and** to the flow as `schedules: { index, resolve }` (the tick reads it). One index serves one flow; an index two flows name is claimed once, for the first flow that names it. **[source]** `st:239-247`, `dsc:206-219`; **[test]** `sct:144`; `goal`'s `app.mts` is the working example.

| Item | Rule | Cite |
| --- | --- | --- |
| `ScheduleIndex.upsert(row)` | Insert or update the row for `(cell, key)`. The caller supplies `nextFireAt`; the index never parses cron | `sidx:102-108` |
| `ScheduleIndex.claimDue(now, limit?)` | Atomically claims rows with `nextFireAt <= now` and advances each to its next time in one transaction, returning the rows with their pre-advance `nextFireAt`. Limit default 100. A row whose cron fails to parse is skipped and left as is, with one warning per process per row | `sidx:110-123`; `sq:76-109`; `pgx:60-130`; `createBadCronWarner` `packages/scheduled/src/createBadCronWarner.ts:49-60` |
| `ScheduleIndex.remove({ cell, key })` | Removes that row; no-op when there is none; never touches another cell's row with the same key | `sidx:125-129` |
| `ScheduleIndexEntry` | `cell` (opaque storage cell: store and compare, never parse), `userId`, `orgId?`, `key`, `cron`, `timezone?`, `nextFireAt` (ms). Identity is `(cell, key)`, so one schedule is one row, and one person can hold the same key in several organizations | `sidx:53-93` |
| What keeps it current | On a collection with an `index`: create upserts (a disabled row is skipped), update re-upserts and recomputes the time or removes the row (disabled, new cron unparseable, or the row's organization disagrees with the writing run's), delete removes. A collection with no `index` saves rows that never fire from the tick | `dsc:263-312`, `dsc:136-150`; `dsct:84`, `dsct:100`, `dsct:111`, `dsct:130`, `dsct:143`, `dsct:168`, `dsct:192` |
| Delivery | At most once. `claimDue` advances rows before returning them; a fire the endpoint then refuses is dropped, not retried | `sidx:47-50`; `tick:25-26` |
| Per-tick limits | At most 100 entries claimed per index per tick; at most 10 dispatches in flight at once | `tick:76-82` (`maxPerTick`, `concurrency` defaults; internal options of `runScheduleTick`, which is not an app-facing export, so state them as defaults only if the page wants a limits row) |
| An entry with no organization | Not dispatched (logged); the rest of the batch still fires | `tick:139-143`; `sct:153` |
| Which time an entry fires for | Its latest due time from the cron and zone it carries, not the first it missed | `tick:147`; `sct:122` |

Backends (`ScheduleIndex` implementations):

| Export | Package | Rule | Cite |
| --- | --- | --- | --- |
| `sqliteScheduleIndex({ filename })` | `@flow-state-dev/store-sqlite` | A SQLite file of its own, schema made on open; the connection stays open for the process | `sq:25-35` |
| `createSQLiteScheduleIndex(db)` | `@flow-state-dev/store-sqlite` | Over a better-sqlite3 `Database` you own. **Open the stores first**: it throws `no such table: schedule_index` if the table does not exist yet (store construction makes it) | `sq:37-41`; **[ran]** `createSQLiteScheduleIndex` on a fresh `:memory:` database threw `SqliteError: no such table: schedule_index`; `packages/store-sqlite/test/schedule-index.test.ts:14-20` calls `initializeSchema` first |
| `createPostgresScheduleIndex(executor)` | `@flow-state-dev/store-postgres` | The executor must implement `beginTx()` (the pool-backed executors from `createPostgresStores` do); `claimDue` uses `FOR UPDATE SKIP LOCKED`, so several processes can claim without handing out the same row | `pgx:1-32` |

Table: `schedule_index` with `cell, key, user_id, org_id, cron, timezone, next_fire_at`, primary key `(cell, key)`; created by store construction, or by hand with `skipSchemaInit: true` (the DDL is on `apps/docs/docs/server/schedule-index.md:95-135`, current against `sq`/`pgx` column lists). The upgrade SQL for an older table is on the same page and is a release-upgrade item, not a Reference row. `packages/store-sqlite/src/schema.ts:223-290` migrates an older table on open.

`@flow-state-dev/scheduled/testing` holds the conformance suite a new index implementation runs (`createScheduleIndexConformanceTests`, used at `packages/store-sqlite/test/schedule-index.test.ts:14`).

## Table 4: Who a scheduled run belongs to

| Case | The run belongs to | Cite |
| --- | --- | --- |
| Static schedule, no `principal` | The principal the endpoint's authentication resolved for the fire (the gateway principal; typically a system user) | `rt:178-200`; `adt:464` |
| Static schedule with `principal` | That user. Its `orgId` may be omitted and then falls back to the gateway's organization | `st:155-177`; `rt:194-200`; `adt:431` |
| Stored (dynamic) schedule | The user and organization in its dispatch id, which must match the row. The resolver sets `principal: { userId, orgId }` from the id and reads the row from that user's data in that organization | `rsr:1-20`, `rsr:161-165`; `rsrt:120`; `cell:199` |
| A stored row that names no organization, or another one than the id | Does not fire. The resolver returns `null` (`404 schedule_not_found`); the tick does not send an entry with no organization | `rsr:151-159`; `rsrt:105`; `cell:238`, `cell:274`, `cell:286`; `sct:153` |
| A hired worker's pinned flow | A dispatch id naming another organization than the worker's, or (for a private worker) another user, resolves as if the stored schedule were missing, before any store is read. The page names it "A flow run by a Workforce worker" and links the Workers page | `rsr:118-125`; `st:90-99`; `cell:404`, `cell:417` |

- **Organization is fixed by who created the row.** `defineScheduleCollection`'s `create` records the creating run's organization; the schedule fires into it, not into whichever organization is firing the tick. A run that tries to point a schedule at another organization is refused, and a write that names another organization is refused (an update never moves a row to another organization: `applyStampedOrgId` in `packages/engine/src/context/resource-registry.ts:429-454`, `dsc:163-167`, `dsc:241-257`). An update from a run in a different organization than the one stored takes the row out of the index (`indexOrgFor` returns null). **[test]** `dsct:168`, `dsct:192`, `cell:333`, `cell:357`.
- **A schedule written by one run fires from the same cell the run wrote.** The cell is the user's data in that organization; the resolver and the fired record use the same cell derivation. A run of the same person in another organization cannot reach it. **[test]** `cell:314`, `cell:238`; **[source]** `rt:109-113`, `rsr:127-137`.
- **Edits and deletes take effect on the next tick.** Updates re-upsert the index row and the resolver reads the row at fire time; delete removes the row and its index entry. A fire claimed before the delete runs only if its dispatch read the row first; after the delete the resolver finds none and the fire answers `404 schedule_not_found`, which is dropped (not retried). `enabled: false` removes the index entry, which pauses. **[test]** `dsct:130`, `dsct:143`; `cell:298` (a full `setState` still fires).
- The fired record: the endpoint keeps one record per schedule, the latest scheduled time it fired, in the user cell of the principal the schedule runs as, at `scheduled-fires/<flowKind>/<scheduleId>` (`FIRED_RECORDS_PATTERN = "scheduled-fires/**"`, exported from `@flow-state-dev/core/types`). A flow that deletes a schedule deletes its record through a collection over that pattern at user scope. **[source]** `st:318-341`, `stm:117-140`.
- Static schedules recover after a crash when `durable` is set (a durable one is re-resolved by its id); the page says "with `durable` set"; a stored (dynamic) schedule's run does not, because its handler comes from the resolver at fire time and is not persisted. **[source]** `st:133-140`, `rt:274-279`; existing page `apps/docs/docs/server/scheduled.md:154-166`.

### The four questions, for each stored part

| Part | Who owns it | Who can see it | Where it is stored | How many |
| --- | --- | --- | --- | --- |
| Stored schedule resource (collection state) | The user who created it, in the organization of the run that created it (user scope; `defineScheduleCollection` forces `scope: "user"`) | That user. The collection has no client config unless you pass `client`; omitted, no client reads the schedules, and `runBy` omitted means a client cannot write them | The app's resource-state store, in the user's cell for that organization, under the collection pattern (typically `schedules/*`) | One per schedule key per user per organization. `flowIsolation` omitted follows the flow's `isolateUserState`; `false` keeps one set across flows. `dsc:206-239`; `rsr:127-137` |
| Schedule index row | Mirrors one stored row; the engine's tick reads it, nobody else writes it | Not exposed to clients. Held in the store's `schedule_index` table | `schedule_index` table in the SQLite file or Postgres database of the index you pass (the same database as the stores when you use the store's own handle; a file of its own with `sqliteScheduleIndex`) | One per `(cell, key)`: exactly one row per active stored schedule; none for a disabled row or one with an unparseable cron. One index per flow. `sidx:53-93` |
| Fired record | The endpoint, for the principal the schedule runs as | Not exposed to clients unless the flow declares a collection over `scheduled-fires/**` | Resource state, in that principal's user cell, key `scheduled-fires/<flowKind>/<scheduleId>` | One per schedule: only the latest scheduled time that fired. `st:318-341` |
| Last-tick record | The engine's tick (the only writer) | Not exposed | The app's resource state, in an engine-owned organization cell, one key | One per app. **[source]** `tick:37-43`, `tick:222-231` (the page should say only "one app-wide record of the last tick"; the cell and key are internal) |
| Tick lease | The local cron's process | Not exposed | `stores.leases`, one sentinel key | One per app. `ls:32-33`, `ls:1-19`. State it only as "one process holds a lease in the store"; the key is internal |
| Static schedule | The flow's author | Anyone who can call the listing endpoint with the secret (cron, description, handler name) | The flow definition, in source | One per key in `schedules.static`. `rt:330-402` |

## Limits (state flat)

- One fire runs one handler for one schedule. A tick that should reach many users is many schedules, each its own fire. **[source]** `st:15-16`; existing page `apps/docs/docs/server/scheduled.md:512-516`.
- Cron resolution is one minute; five fields only. `st:365-367`, `tick:34-35`.
- Delivery is at most once. No retry from the tick; no backfill of missed times. `tick:25-26`; `sct:99`.
- A stored schedule's run is not crash-recoverable; a static one is. `st:133-140`.
- The listing shows static schedules only. `rt:330-402`.
- `onOverlap: "queue"` is not available. `st:461`, `sval:152`.
- Dispatch is fire-and-forget: `202` means started, not finished. `rt:322-327`.
- A scheduled handler is not reachable through the action surface or MCP. `st:133-140`; `sval:293`.

## Rows other pages moved here: disposition

Rows were listed with the page's grep (`grep -rhE -- '→ R-33( \(corrected by pass 5\))?$' docs/contributing/docs-revamp/pages --include=*.record.md` printed them, though grep also reported `--include=*.record.md: No such file or directory` because of the `--` placement; the rows came through). 24 rows. Each checked against the code above.

**Carried (true, or true once corrected):**

1. "Schedule fields (name, cron string, block) and the tick/dispatch endpoint a scheduler calls, plus the adapter that runs it" — carried in Tables 1, 2, and the tick lookup. Corrected: there is no `name` field (the id is the map key or the row key), and the stored row names its block with `kind`, not `block`.
2. "Schedule entry: a named entry (lowercase letters, digits and dashes) with a five-field cron string... static fired by an external scheduler... a stored entry... also fired by the host's own minute tick... fresh run as the entry's `principal`, or the gateway principal" — carried. Corrected: a static schedule on an app with no outside cron is also fired by the local tick; only a flow with `scheduler: false` needs an outside caller. A fresh run each time: true.
3. "Scheduled action: schedule fields, tick endpoint, who the scheduled run belongs to" — the page's own table list; carried as Tables 1, 2, 4.
4. "`onOverlap` (`"skip"` default, or `"allow"`)... answered `200 { status: "skipped" }`... check best effort... separate from the action's `concurrency` policy" — carried. The skip answer also has `reason: "in_flight"` and `requestId`, and a concurrency `reject` answers the same shape.
5. "Cron route: `vercelScheduler().route`... GET of one cron route... `vercel.json` sets only how often" — carried (Vercel table).
6. "Route options `vercelScheduler({ secret? })`... `CRON_SECRET` read on each call... base URL is the cron request's origin... `500` when not passed to `createFlowState` or when the tick fails" — carried.
7. "Dispatch with no body: stands in for the most recent scheduled time; a repeat for the same time returns `duplicate`" — carried. Precise rule: the latest time already due, counting one up to 5 seconds early as due.
8. "Dispatch responses: `202` started, `200 duplicate`, `200 skipped`. The cron route does not relay them; answers `200` with the count, `401`, or `500`" — carried and extended to the full answer table.
9. "Schedule list endpoint ... lists the flow's registered schedules" — carried, corrected: it lists static schedules plus a `dynamic.provided` flag, with an `action` field holding the handler block's name.
10. "Tick: one cron entry fires every due schedule of every flow, static and dynamic" — carried. Dynamic due times come from the flow's `schedules.index`; a flow with only `resolve` is not ticked.
11. "Delivery: one tick per cron beat... non-2xx not retried... after downtime fires once, late, for the latest time it missed" — carried.
12. "Schedule fields: `cron`, `kind`, `input`, `enabled`, `timezone`, `onOverlap`, `description`, `orgId`, `metadata`" — carried as the stored-row table. Corrected: that list is the stored row; a static schedule has `block` instead of `kind` and adds `principal` and the action-core fields. `orgId` is written by `create`, not set by the caller. True.
13. "Schedule index: list of next fire times the clock reads; the collection writes it on every create, update and delete; no `index` saves rows that never fire; rows owned by and readable only by the creating user" — carried. Corrected: they never fire from the tick (an outside caller can still POST the dispatch route). The collection writes the index only when given one; disabled rows are removed.
14. "Index backends: `createSQLiteScheduleIndex` and `createPostgresScheduleIndex`, the `ScheduleIndex` methods, and the open-after-the-stores ordering rule" — carried. The ordering rule is real for `createSQLiteScheduleIndex(db)` (**[ran]**); `sqliteScheduleIndex({ filename })` has no such rule because it makes its own schema. Added `sqliteScheduleIndex`.
15. "The tick endpoint: what calls it, the bearer header each fire carries, and that a flow with `resolve` and no `index` is never ticked. Principal resolution for `source === "scheduled"` belongs on authentication" — carried; the resolution is linked, not restated.
16. "Tick behaviour: once a minute, covers every flow's static and user-made schedules, one app copy ticks" — carried.
17. "Missed ticks and exactly-once firing... Hosting on Vercel" — carried.
18. "Two rows. Collection `create` options: `replace: true`... (R-08). Who a scheduled run belongs to: `create` records the creating run's organization, edits and deletes take effect on the next tick (R-33)." — the second row carried (Table 4). The first (`replace: true`) is R-08's, not this page's; not carried here and not checked here.
19. "Cron validation: `create` does not validate `cron`..." — carried and **[ran]**: an unparseable cron or unknown time zone is saved, warned and not indexed; a six-field cron is indexed and refused `400 invalid_schedule` at each fire.
20. "Where the clock runs: only where the app serves requests, so a schedule under `fsdev run` waits for a server; a scheduled run's source is `scheduled`" — carried. (The same tests also show a job-queue worker ticks.)
21. "Failure and crash behaviour of a fire: at-most-once; a user-made schedule's run is lost if the process dies mid-run, a static schedule's run recovers; with a `process-only` job queue, fires run through the queue" — carried.
22. "Limits: minimum cron resolution of one minute; one fire runs one handler" — carried.

**Dropped:**

23. "BullMQ schedule bridge: `registerStaticSchedules` and `createScheduleDispatchWorker` options, idempotent upsert, fire POSTs..." — **dropped, no longer exists.** `packages/bullmq/src/index.ts:1-34` exports no schedule code and says "Schedules need nothing from it: the engine's local cron, elected by the shared store's lease, fires them"; `goal` signal e imports `registerStaticSchedules`, `createScheduleDispatchProcessor`, `createBullmqScheduleIndex` and the `@flow-state-dev/bullmq/schedules` entry and checks that none resolves; `git ls-files packages/bullmq` has no schedule source. (The only trace is stale files in `packages/bullmq/dist`, not exports, and `packages/bullmq/README.md`, which still names them and must be fixed there, not cited here.) The BullMQ truth for this page is one sentence: a `process-only` job-queue worker runs the tick and its fires go through the queue.
24. "Schedule index implementations: BullMQ index returns no due schedules from `claimDue`, so no tick is required" — **dropped, no longer exists** (same evidence: `createBullmqScheduleIndex` is removed, `goal` signal e). With BullMQ the tick is still required and runs in the worker.

## Things the existing docs say that the code contradicts (do not copy)

- `apps/docs/docs/server/scheduled.md:7-12`, `:32-55`, `:512-520`: says you mount `createScheduledTransportAdapter()` on `adapters`, that there is "no framework-side scheduler loop", and no missed-window handling. The adapter factory is gone (`goal` signal g checks no package source names it; `bi:66` dispatches with no adapters), the local cron and `scheduler` option exist, and a missed time fires once, late. Also `idempotencyWindowMs` / `idempotencyOptions` on that adapter no longer apply.
- `apps/docs/docs/server/scheduled.md:5-25`: "the framework never owns schedule storage" is true of a hand-written `resolve`, but `@flow-state-dev/scheduled` ships the collection, resolver and index.
- `apps/docs/docs/server/schedule-index.md:15-30`: says a static-only app "gets its own cron row" and the polling tick is a host-built piece. The engine's tick now claims the index.
- `apps/docs/docs/advanced/inbound-transports.md:156-160`: says `@flow-state-dev/scheduled` mounts the dispatch route. The router does.
- `apps/docs/guides/keeping-a-flow-running.md:240`, `apps/docs/guides/scheduled-vercel-cron.md:38-41`: name `createScheduledTransportAdapter()` and `createGetToPostCronShim` from `@flow-state-dev/vercel/schedules`. Both are removed (`goal` signals e and g).
- `packages/bullmq/README.md`: still lists the BullMQ schedule bridge (removed, above).
- `apps/docs/docs/server/scheduled.md` says `405` for a wrong method; nothing in the endpoint's code or tests pins it.

## Not on the page (belongs elsewhere)

- How to set up Vercel, a long-lived host, or run-time schedule creation: `build/schedules/*` pages.
- The principal-resolver branch on `ctx.source === "scheduled"`: the Authentication page.
- `defineResourceCollection` options such as `replace: true`: R-08.
- Upgrade SQL for an older `schedule_index` table and the attribution recipe for a legacy row without an organization: the release's Upgrading page.


## Added in revise round 1

- **Example files.** The page now shows `src/flows/digest/blocks/send-digest.ts` (a `handler` named `send-digest` with `inputSchema: z.object({})`) and `src/lib/flow-state.ts` (`createFlowState({ flows: [digest()], scheduler })` with `scheduler = vercelScheduler()`), and `defineFlow` carries `actions: {}`, because `defineFlow`'s result type requires `actions` (`packages/core/src/types/flow.ts:802-803`). `flows` takes an array of flow instances, so the flow is called: `digest()`. All four files type-check together. **[ran]**
- **Bearer resolver.** `createBearerSecretPrincipalResolver` throws at construction on an empty secret (`assertSecret`), answers a wrong bearer with `PrincipalResolutionError` status 401, and returns `null` for a missing header. `packages/engine/src/transports/auth/createBearerSecretPrincipalResolver.ts:55-85`.
- **Vercel cadence.** A schedule fires on the first tick after its time (the tick fires the latest missed time once), so a 15-minute cadence runs `0 8 * * *` between 08:00 and 08:15. `tick:108-109`, missed-tick rules above.
- **Cron answer.** `dispatched` counts fires sent (`vs:` route), not fires that succeeded; a `0` is normal between times.
- **Memory and filesystem stores.** The once-per-time record holds within one process (stated above), so the Limits list says to use SQLite or Postgres for more than one.
- **Left off the page, no source in the fact sheet's allowed set:** that a run continuing after the `202` needs the host to keep a serverless function alive; that a scheduled principal must name an organization or the call is refused; that a rotated secret needs a redeploy. `create` with `replace` is R-08's and the `ctx.source === "scheduled"` resolver branch is the Authentication page's.

## Added in revise round 2

- Checked `flow_not_found` (404) against `flow_unregistered` (503): both reachable as written. `flow_not_found` is an unknown flow or one with no `schedules` (`rt:404-423`, `bi:94`, `bi:106`); `flow_unregistered` is a flow unregistered between the lookup and the dispatch (`rt:284-300`, `adt:604`).
- `upsert` takes `nextFireAt` from the caller and does not parse cron; `claimDue` does parse the cron to advance rows and skips unparseable ones (`sidx:102-123`).
- Index failure or 30-second timeout: the next tick retries what the index had not handed out; rows handed out after the timeout are logged as not fired and fire at their next time (`tick:116-131`, `ftp:27-69`).
- Worker case: another organization's id resolves as missing; another user's id too when the worker belongs to a single user (`rsr:118-125`).
- The `202` row now carries the request-record sentence.

## Added in revise round 3

- `block` takes a block of any kind (`st:435`, `st:127-135`): the page says "block", not "handler", except where it names `sendDigest`, which is a handler.
- A stored schedule has no `durable` field (the stored row has only the fields in the stored table), so the page says it has none and its run is lost on a crash (`st:127-139`).
- The listing needs the same principal as dispatch, whatever resolver the flow uses, so the Static schedule line says "anyone your `resolvePrincipal` lets call the listing" (`rt:356-379`).
- Who a run belongs to is named by the app's `resolvePrincipal`; `createBearerSecretPrincipalResolver` returns the `principal` option it was given (`createBearerSecretPrincipalResolver.ts:55-85`). A static schedule's missing `orgId` falls back to the orgId of that resolved principal (`rt:194-200`).
- Local cron starts when the app builds its router (`ready()`, `getRouter()` or a server) or a job queue starts processing (`cfs:1343-1430`). Stored-schedule key may contain `:`; the dispatch id joins `<orgId>/<userId>/<key>` with `/`.
