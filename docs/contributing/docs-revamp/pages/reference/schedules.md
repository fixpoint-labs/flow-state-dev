---
title: Schedules
type: reference
description: "The fields of a schedule, the endpoint every fire is sent to, what runs the tick, how a missed tick is handled, the schedule index, and whose run a fired schedule is."
---

# Schedules

A schedule runs a block on a cron. A flow declares its schedules in `schedules`, and the framework keeps the clock: once a minute a routine called the tick finds every schedule that is due and POSTs each one to a single endpoint, the same endpoint an outside cron service would call. The endpoint checks the caller, starts a fresh run, and records which scheduled time it fired, so one time never runs twice.

Because a fire is an ordinary request to one endpoint, a schedule is authenticated and attributed like any other call, and it fires the same way whether the tick runs inside your process, on Vercel Cron, or in a job-queue worker.

This page uses one app. The `digest` flow has a static schedule, `morning-digest`, written in the flow. Users also have stored schedules, made at run time with `defineScheduleCollection`, such as `weekly` for user `alice` in organization `acme`.

```ts title="src/flows/digest/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { sendDigest } from "./blocks/send-digest";

export default defineFlow({
  kind: "digest",
  actions: {},
  schedules: {
    static: {
      "morning-digest": {
        cron: "0 9 * * *",
        timezone: "Europe/Paris",
        block: sendDigest,
        description: "Send the daily digest",
      },
    },
  },
});
```

`sendDigest` is a handler block. The flow declares no actions, and a scheduled block is not an action, so the dispatch endpoint is the only way to run it.

```ts title="src/flows/digest/blocks/send-digest.ts"
import { z } from "zod";
import { handler } from "@flow-state-dev/core";

export const sendDigest = handler({
  name: "send-digest",
  inputSchema: z.object({}),
  execute: async () => ({ sent: true }),
});
```

## Schedule fields

### A static schedule

Declared in `schedules.static`, keyed by id. The id is lowercase letters, digits and dashes, starts with a letter or digit, and is at most 64 characters. A bad id, a missing `block`, or any invalid field below throws when the flow is defined.

| Field | Rule |
| --- | --- |
| `block` | Required. The block that runs. Not reachable through the action surface or MCP. |
| `cron` | Required. Five space-separated fields: minute, hour, day of month, month, day of week. Any other count, or a cron that does not parse, throws. |
| `input` | A value, or `(ctx) => value`. A value is checked against the block's `inputSchema` at definition. A function is called at fire time with `{ scheduleId, cron, nominalFireTime, principal, flowKind, origin }`. With neither, the block receives `{}`. |
| `principal` | `{ userId, orgId? }`. Who the run is for. See [Who a scheduled run belongs to](#who-a-scheduled-run-belongs-to). |
| `timezone` | IANA zone. `"UTC"` when omitted. An unknown zone throws. |
| `onOverlap` | `"skip"` (default) or `"allow"`. Any other value throws. See [`onOverlap`](#onoverlap). |
| `description` | Free text, shown in the listing. |
| `enabled` | Default `true`. A disabled schedule is not ticked, appears in the listing with `enabled: false`, and its dispatch answers `404 schedule_not_found`. |

A static schedule also takes the action fields `durable`, `tokenBudget`, `concurrency`, `inputSchema`, `onCompleted`, `onErrored`, `userMessage`, `taskOf` and `autoResume`. A static id wins over `resolve` for the same id.

### A stored schedule

A stored schedule lives in a collection made with `defineScheduleCollection`. A block cannot be stored, so the schedule names one with `kind`, and the `blocks` map you give `createResourceCollectionScheduleResolver` turns the `kind` into a block. A `kind` with no entry in `blocks` resolves to nothing and answers `404`.

| Field | Rule |
| --- | --- |
| `cron` | Required. Not validated on write. See [Bad cron on write](#bad-cron-on-write). |
| `kind` | Required. Names the block in the resolver's `blocks` map. |
| `input` | Any JSON value. |
| `timezone` | IANA zone, UTC when omitted. |
| `onOverlap` | `"skip"` or `"allow"`. |
| `description` | Free text. |
| `enabled` | Default `true`. `false` removes the row from the index, so it stops firing without being deleted. |
| `orgId` | Written by `create` from the creating run's organization. Not set by the caller. |
| `metadata` | A record kept with the row. Nothing reads it. |

The resolver copies `cron`, `input`, `timezone`, `onOverlap` and `description` onto the fired schedule and sets `principal` from the dispatch id. A row has no `name`; its key is its name. The key may contain `:`. The dispatch id built from it joins `<orgId>/<userId>/<key>` with `/`.

### `onOverlap`

With `"skip"`, a fire answers `200 { status: "skipped", reason: "in_flight", requestId }` when an earlier run of the same schedule is active. The check is best effort: two near-simultaneous ticks can both pass it, and the once-per-time record then lets one fire. `"allow"` omits the check.

`onOverlap` is separate from the action's `concurrency` policy. A dispatch that a concurrency `reject` refuses also answers `200 skipped`.

### Bad cron on write

`create` on a schedule collection does not check `cron` or `timezone`.

| Written | What happens |
| --- | --- |
| A cron that does not parse, or an unknown time zone | The row is saved and a warning is logged. It has no index row, so the tick never fires it. |
| Six fields (the sixth is read as seconds) | The row is indexed and the tick sends it. The endpoint answers each fire `400 invalid_schedule`, so it never runs. |

Check the cron before writing it: it must have five fields, and `parseNextFireAt(cron, timezone)` from `@flow-state-dev/scheduled` returns `null` for one that does not parse. `isKnownTimeZone` from `@flow-state-dev/core/types` checks a time zone.

### The flow's `schedules` option

| Key | Rule |
| --- | --- |
| `static` | The map above. |
| `resolve(scheduleId, ctx)` | Looks up a stored schedule when `static` has no entry. Returns `null` for a `404`. |
| `index` | The [schedule index](#the-schedule-index) the tick reads. Without it, the tick fires no stored schedule. |

Static entries are validated when the flow is defined. `resolve` is not run then.

## The dispatch endpoint

Every fire goes to this endpoint. The router mounts both routes on every app, under `/api/flows`.

| Route | Purpose |
| --- | --- |
| `POST /api/flows/:flowKind/schedules/*scheduleId/dispatch` | Fire one schedule. |
| `GET /api/flows/:flowKind/schedules` | List the flow's static schedules. |

A stored schedule's id goes in the URL as one encoded segment: `encodeURIComponent(formatScheduleId(orgId, userId, key))`, which joins `<orgId>/<userId>/<key>`: `alice`'s `weekly` in `acme` is `POST /api/flows/digest/schedules/acme%2Falice%2Fweekly/dispatch`. Characters outside `A-Z a-z 0-9 - _ . ! ~ * ' ( ) % : /` answer `400 invalid_schedule_id`. A flow that is unknown, or has no `schedules`, answers both routes `404 { "error": "flow_not_found" }` before any principal resolver runs. An app that registers its own route on either path fails at startup.

### The request

```http
POST /api/flows/digest/schedules/morning-digest/dispatch
Authorization: Bearer <secret>
Content-Type: application/json

{ "nominalFireTime": "2026-11-20T08:00:00Z" }
```

- The `Authorization` header is sent when the caller has a secret. The tick sends `CRON_SECRET`, or the secret `vercelScheduler` was given.
- The call is authenticated like any inbound request: the flow's `authentication.resolvePrincipal` runs with `source: "scheduled"`. A thrown `PrincipalResolutionError` answers `401`. Wiring it is on [Authentication and tenancy](./authentication.md). `createBearerSecretPrincipalResolver` from `@flow-state-dev/engine` handles a shared secret: a wrong secret answers `401`, and building it with an empty secret throws, so an unset `CRON_SECRET` fails when the app loads.
- The body is optional. An empty or unparseable body counts as no time. A body with an `idempotencyKey` field answers `400 idempotency_key_removed`.
- A scheduled run's `source` is `"scheduled"`. Its request metadata carries `schedule: { scheduleId, origin, cron, nominalFireTime, dispatchedAt, timezone }`.

### Which scheduled time a fire counts against

| The fire | Counts against |
| --- | --- |
| Carries `nominalFireTime` | The scheduled time of the cron within 5 seconds of it. Near no scheduled time: `400 not_a_scheduled_time`. More than 5 seconds early: `400 not_yet_due`. Not an ISO time: `400 invalid_nominal_fire_time`. |
| Carries no time | The latest scheduled time already due, counting one up to 5 seconds early as due. Never the next one. |
| Carries a time more than one period behind the latest due time | `200 { status: "duplicate", reason: "stale", scheduleId, nominalFireTime }`. Nothing runs and a warning is logged. A scheduler that sends a fixed time lands here; send no body. |

Each scheduled time of a schedule fires at most once, across retries, hosts and restarts. The endpoint keeps one record per schedule, the latest time that fired, and a fire for that time or an earlier one answers `duplicate`. A retry of a missed time runs only while no later time has fired. The record holds across processes on SQLite and Postgres stores, and within one process on the memory and filesystem stores.

### Answers

| Status | Body | When |
| --- | --- | --- |
| `202` | `{ status: "accepted", scheduleId, origin, requestId }` | Started. It does not say the run finished; errors after it are on the run's request record. |
| `200` | `{ status: "duplicate", scheduleId, nominalFireTime }` | That time, or a later one, already fired. |
| `200` | `{ status: "skipped", reason: "in_flight", requestId }` | `onOverlap: "skip"` found a run of the schedule active, or the action's `concurrency` refused. |
| `400` | `invalid_schedule_id` · `invalid_schedule` (with `message`) · `not_a_scheduled_time` · `not_yet_due` · `invalid_nominal_fire_time` · `idempotency_key_removed` | See above. `invalid_schedule` covers a cron that is not five fields, an unknown zone, no block, a bad `onOverlap`, or an `input` that fails the schema. `idempotency_key_removed`: the body has an `idempotencyKey` field, which is not accepted. |
| `401` | `unauthorized` | The principal resolver refused the call. |
| `404` | `flow_not_found` · `schedule_not_found` | No such flow, or no static entry, a `null` from `resolve`, or `enabled: false`. |
| `500` | `resolver_failed` · `dispatch_failed` | `resolver_failed`: `resolve` threw. `dispatch_failed`: the `input` function threw. |
| `503` | `flow_unregistered` · `dispatch_failed` | `flow_unregistered`: the flow was unregistered while the fire was being handled. `dispatch_failed`: the run could not be accepted for another reason, such as a store that did not answer. |

A fire answered `500`, `503` or `skipped` gives its time back, so a retry of that time runs while no later time has fired.

### The listing

`GET /api/flows/:flowKind/schedules` needs the same principal as dispatch and answers `200`:

```json
{
  "static": [
    {
      "id": "morning-digest",
      "cron": "0 9 * * *",
      "action": "send-digest",
      "timezone": "Europe/Paris",
      "description": "Send the daily digest",
      "enabled": true
    }
  ],
  "dynamic": { "provided": true }
}
```

`action` is the block's name. `dynamic.provided` is `true` when the flow has a `resolve`. Stored schedules are not listed.

## What calls the tick?

The tick is one routine that covers every flow: each enabled static schedule, and each due entry of each flow's `schedules.index`. The `scheduler` option of `createFlowState` decides what runs it.

| `scheduler` | What runs the tick |
| --- | --- |
| Omitted | The built-in local cron, every minute, in a process that serves requests. It starts when the app builds its router (`ready()`, `getRouter()` or a server) or a job queue starts processing, and a registered flow declares a static schedule or a `schedules.index`. Fires are sent to the app's own endpoint, in process. |
| A `SchedulerAdapter` | The adapter. `createFlowState` calls its `start(ticker)` once. `ticker.tick({ baseUrl?, secret? })` fires what is due, and with a `baseUrl` each fire is its own network request. `start(ticker)` returns a handle with `stop()`; disposing the app calls it first. |
| `vercelScheduler()` | One Vercel Cron entry. See [Vercel](#vercel). |
| `false` | Nothing. The app fires its own schedules, for example an outside cron POSTing the endpoint. |

The local cron:

- **One process ticks per deployment.** It holds a lease in the store, and only the holder ticks, so two processes over one shared store tick once between them. A holder that is disposed hands over at once. One that crashes hands over within three minutes.
- **It does not run under `fsdev run`, `fsdev chat` or `fsdev block`.** A schedule written there fires only once a server runs.
- **A job-queue worker ticks.** A process whose `jobQueue` has `mode: "process-only"` ticks, and its fires go through the queue, so they get its retries and survive a worker crash. With `mode: "enqueue-only"`, or `scheduler: false` on the web process, only the worker fires schedules. See [Run background jobs with BullMQ](../build/background-jobs-bullmq.md).
- **It warns once** in production on in-memory or filesystem stores, whose lease cannot keep a second server from ticking, and once on Vercel when the local default is in use.
- **A flow whose `schedules` has `resolve` and no `index` is never ticked.** Its fires have to come from an outside caller.

### Vercel

```ts title="src/lib/flow-state.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { vercelScheduler } from "@flow-state-dev/vercel";
import digest from "../flows/digest/flow";

export const scheduler = vercelScheduler();
export const flowState = createFlowState({ flows: [digest()], scheduler });
```

```ts title="src/app/api/cron/route.ts"
import { scheduler } from "../../../lib/flow-state";

export const GET = scheduler.route;
```

One cron entry in `vercel.json` calls that route.

| Item | Rule |
| --- | --- |
| Cadence | Sets only how often the tick runs. Due times come from each schedule's `cron`, and a schedule fires on the first tick after its time: `0 8 * * *` on a 15-minute cadence runs between 08:00 and 08:15. Use once a minute for minute-level crons. |
| `secret` | `vercelScheduler({ secret })`. Default `process.env.CRON_SECRET`, read on each call. Each fire the tick sends carries the same secret. |
| Base URL | The origin of the cron request, so each fire is its own function invocation on that deployment. |
| Answers | `200 { dispatched: <fires sent> }`, which counts fires sent, not fires that succeeded. `0` is normal between scheduled times. `401` for a missing or wrong secret, and for every call when no secret is configured. `500` when the tick rejects, or when the scheduler was never passed to `createFlowState`, as in an app running the local cron. |
| Relay | The route does not relay the endpoint's `202`, `duplicate` or `skipped`. A fire answered with an error status is logged. |

## How is a missed tick handled?

- A schedule fires once, for the latest time it missed. Earlier missed times are dropped: no burst after an outage, no backfill. A `*/5` schedule that was down for 23 minutes fires 09:20 once, not 09:05, 09:10 and 09:15.
- A tick that runs again in the same minute sends nothing new. A schedule fires only for a time after the app's last tick.
- On a first tick with no record, the tick looks back one minute, so a new schedule does not fire a time long past.
- A fire the endpoint refuses, or one that throws, is logged with flow, schedule and status, and not retried. Delivery is at most once. `202` and `duplicate` are not logged.
- If a schedule index fails, or takes longer than 30 seconds to answer, the tick fires the static schedules and the other indexes, then fails. A cron route answers `500`. The next tick retries the schedules that `claimDue` had not returned. Rows it returned after the 30 seconds do not fire for this time; each is logged and fires at its next scheduled time.
- The finest cadence is one minute.

## The schedule index

The index is a derived list of each stored schedule's next fire time. The tick claims what is due from it. The schedule collection is the source of truth.

Pass the same index to `defineScheduleCollection({ pattern, index })`, so collection writes keep it current, and to the flow as `schedules: { index, resolve }`, so the tick reads it. One index serves one flow. A collection with no `index` saves rows that never fire from the tick.

| Item | Rule |
| --- | --- |
| `upsert(row)` | Inserts or updates the row for `(cell, key)`. `upsert` takes `nextFireAt` from the caller and does not parse the cron. |
| `claimDue(now, limit?)` | In one transaction, claims rows with `nextFireAt <= now`, advances each to its next time, and returns them with the earlier `nextFireAt`. `limit` defaults to 100. A row whose cron fails to parse is skipped and left alone, with one warning per process per row. |
| `remove({ cell, key })` | Removes that row. No-op when there is none. Never touches another cell's row with the same key. |
| `ScheduleIndexEntry` | `cell` (opaque: store and compare it, never parse it), `userId`, `orgId?`, `key`, `cron`, `timezone?`, `nextFireAt` in milliseconds. One schedule is one row, identified by `(cell, key)`. |
| Kept current by | `create` upserts, and skips a disabled row. `update` re-upserts and recomputes the time, or removes the row when it is disabled, its new cron does not parse, or its organization disagrees with the writing run's. `delete` removes. |
| Delivery | At most once. `claimDue` advances rows before returning them, so a fire the endpoint refuses is dropped. |
| Entry with no organization | Not dispatched and logged. The rest of the batch fires. |
| Time an entry fires for | Its latest due time from the cron and zone it carries, not the first it missed. |

### Backends

| Export | Rule |
| --- | --- |
| `sqliteScheduleIndex({ filename })` from `@flow-state-dev/store-sqlite` | A SQLite file of its own. The schema is made on open. |
| `createSQLiteScheduleIndex(db)` from `@flow-state-dev/store-sqlite` | Over a better-sqlite3 `Database` you own. Open the stores first: it throws `no such table: schedule_index` until store construction has made the table. |
| `createPostgresScheduleIndex(executor)` from `@flow-state-dev/store-postgres` | The executor must implement `beginTx()`. The pool-backed executors from `createPostgresStores` do. Several processes can claim from one index, and no entry is given to two of them. |

The table is `schedule_index`, with columns `cell`, `key`, `user_id`, `org_id`, `cron`, `timezone` and `next_fire_at`, and primary key `(cell, key)`. Store construction creates it. A new index implementation runs the conformance suite from `@flow-state-dev/scheduled/testing`.

## Who a scheduled run belongs to

| Case | The run belongs to |
| --- | --- |
| Static schedule, no `principal` | The principal your `authentication.resolvePrincipal` returned for the fire. With `createBearerSecretPrincipalResolver`, that is the `principal` you gave it, typically a system user. |
| Static schedule with `principal` | That user. A missing `orgId` falls back to the organization of the principal your `resolvePrincipal` returned for the fire. |
| Stored schedule | The user and organization in its dispatch id. The resolver sets `principal: { userId, orgId }` from the id and reads the row from that user's data in that organization. |
| A stored row with no organization, or one other than the id's | Does not fire. The resolver returns `null` (`404 schedule_not_found`), and the tick sends no entry without an organization. |
| A flow run by a Workforce worker ([Workers](../concepts/workers.md)) | If the dispatch id names an organization other than the worker's, the schedule resolves as missing (`404 schedule_not_found`). The same applies to another user's id when the worker belongs to a single user. |

- **The organization is fixed when the row is created.** `create` records the creating run's organization, and the schedule fires into it, not into the organization of whatever run is ticking. A write that names another organization is refused. An update from a run in a different organization than the one stored takes the schedule out of the index.
- **A user in another organization cannot reach the row.** The row lives in the user's data for one organization.
- **Edits and deletes take effect on the next tick.** A delete removes the stored schedule and its index entry together. A fire already under way when you delete the schedule can run once more. If it does not, it answers `404 schedule_not_found` and is dropped. `enabled: false` pauses a schedule without deleting it.
- **Each fire is a fresh run.** A static schedule with `durable` set recovers after a crash. A stored schedule has no `durable` field, and its run is lost if the process running it crashes.

### What is stored, and who sees it

| Part | Owner | Visible to | Stored in | How many |
| --- | --- | --- | --- | --- |
| Stored schedule | The creating user, in the creating run's organization (user scope) | That user, in a block through the collection's resource on `ctx.resources`. No client reads or writes schedules unless the collection sets `client` and `runBy` | The app's resource-state store, under the collection pattern | One per key per user per organization. `defineScheduleCollection`'s `flowIsolation`, when omitted, follows the flow's `isolateUserState`; `false` keeps one set across flows |
| Index row | Mirrors one stored row. Only the tick reads it | No client | The `schedule_index` table of the index you passed | One per active stored schedule. None for a disabled row or an unparseable cron |
| Fired record | The endpoint, for the principal the run belongs to | No client, unless the flow declares a collection over `scheduled-fires/**` | That principal's user data, key `scheduled-fires/<flowKind>/<scheduleId>` | One per schedule, holding the latest time that fired |
| Last-tick record and tick lease | The engine | No one | The app's store | One of each per app |
| Static schedule | The flow's author | Anyone your `resolvePrincipal` lets call the listing | The flow's source | One per key in `schedules.static` |

## Limits

- One fire runs one block for one schedule. To reach many users, make many schedules.
- Cron is five fields, with a one-minute resolution.
- Delivery is at most once, with no retry from the tick and no backfill. A tick fires each due schedule once.
- On the memory and filesystem stores the once-per-time record holds within one process only. Use SQLite or Postgres for more than one.
- The listing shows static schedules only.
- A scheduled block is not reachable through the action surface or MCP.
