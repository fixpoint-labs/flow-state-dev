# Scheduled Actions Adapter

`@flow-state-dev/scheduled` mounts the endpoint a flow's schedules are
fired through, over HTTPS. It is a concrete `InboundTransportAdapter` —
see [Inbound Transports](./inbound-transports.md) for the contract.

`host.dispatch` runs the action. `RequestRecord.source = "scheduled"`
carries provenance. The framework owns the dispatch contract,
validation, two-phase auth, provenance metadata, and the one tick that
fires every schedule of every flow ([The tick](#the-tick)). The host
owns the storage that backs dynamic schedules, and on a serverless host
the one cron route that runs the tick. There is no retry queue.

Install, mounting, static/dynamic examples, and the Vercel walkthrough
live in
[Scheduled actions](../../apps/docs/docs/server/scheduled.md).

## Endpoint shape

```
POST /api/flows/:flowKind/schedules/:scheduleId/dispatch
GET  /api/flows/:flowKind/schedules
```

`GET` and `DELETE` on the dispatch path return 405. POST on the
listing path returns 405. POST is required on dispatch so the body
can carry `nominalFireTime` and so auth flows through `Authorization`
rather than query strings. A body carrying `idempotencyKey` is refused
with 400 `idempotency_key_removed`: the scheduled time is the key.

## The `schedules` config block

`schedules` is a resolution surface on `FlowDefinition`:

```ts
type SchedulesConfig = {
  static?: Record<string, ScheduleConfig>;
  resolve?: (
    scheduleId: string,
    ctx: ScheduleResolutionContext
  ) => Promise<ScheduleConfig | null> | ScheduleConfig | null;
};

type ScheduleConfig = ActionCore & {
  cron: string;
  input?: unknown | ScheduleInputFn;
  principal?: ResolvedPrincipal;
  timezone?: string;
  onOverlap?: "skip" | "allow";
  description?: string;
  enabled?: boolean;
};
```

A schedule is an action in scheduled form: it carries `ActionCore`
inline, so the handler needs no entry in `flow.actions` and has no
HTTP/MCP caller surface. `defineScheduleBinding({ cron, block, ... })`
is the typed constructor.

Static lookup runs first; `resolve` runs only when `static[id]` is
absent. Static wins so a host can override one dynamic schedule
without changing the resolver.

## Validation

`validateScheduleConfig` (from `@flow-state-dev/core`) runs at
registration for the static map and at dispatch for whatever the
resolver returned.

- Static ids: `^[a-z0-9][a-z0-9-]{0,63}$`. Dynamic ids:
  `^[a-z0-9][a-z0-9:/_-]{0,127}$`. The dispatch route validates the
  URL pattern before any resolver call.
- The binding must carry a `block`.
- Cron is exactly five fields (`isFiveFieldCron`; a sixth would be
  seconds) and parses under `cron-parser` in the schedule's `timezone`.
  The zone, when set, must be an IANA zone the runtime knows. The
  endpoint evaluates the cron in that zone to name scheduled times.
- Static `input` matches the binding's effective input schema.
  Dynamic input is validated at dispatch.
- `onOverlap` is `"skip"` or `"allow"`. `"queue"` is reserved.
- `principal.userId` is a non-empty string when the field is set.

Registration failures throw from `createFlowInstance`. Dispatch
failures return 400 `invalid_schedule`.

## Dispatch flow

`handleDispatch` runs in this order:

1. Validate the URL `scheduleId` against the dynamic-id pattern.
2. Resolve the flow. Unknown → 404.
3. Parse the body (both fields optional). Preserve `rawBody` for
   signature-checking resolvers.
4. Gateway auth via `host.resolvePrincipal({ source: "scheduled" })`.
   For dynamic schedules this runs *before* the resolver. A
   `PrincipalResolutionError` returns its own status with
   `{ error: "unauthorized" }`.
5. A body `idempotencyKey` → 400 `idempotency_key_removed`.
6. Resolve the schedule: `static[id]`, else `resolve(...)`.
   `null` → 404 `schedule_not_found`. Throw → 500 `resolver_failed`.
7. `validateScheduleConfig({ origin: "dynamic", … })`.
   Fail → 400 `invalid_schedule`.
8. Overlap. If `onOverlap !== "allow"`,
   `findScheduledRequest` scans in-flight scheduled requests for
   `(flowKind, source, metadata.schedule.scheduleId)`. Match → 200
   `{ status: "skipped", reason: "in_flight" }`.
9. Effective principal: `schedule.principal ?? gatewayPrincipal`.
9a. The scheduled time (`scheduledTimeOf`). A carried `nominalFireTime`
    counts against the scheduled time within 5 s of it; none counts
    against the latest one due by now + 5 s. A carried time near no
    scheduled time → 400 `not_a_scheduled_time`; one not due yet → 400
    `not_yet_due`; one more than a period behind the latest due time →
    200 `{ status: "duplicate", reason: "stale" }` and a warning.
9b. The claim (`claimScheduledTime`): one record per schedule,
    `{ lastFiredAt }`, at `scheduled-fires/<flowKind>/<scheduleId>` in
    the effective principal's non-isolated user cell (the derivation the
    resolver reads by), written with the resource-state store's
    compare-and-set. A time at or before `lastFiredAt` → 200
    `{ status: "duplicate" }`. The record is a floor whatever the cron;
    an old record that also carries `cron` and `timezone` reads the same.
10. Resolve input (static value or `schedule.input(ctx)`).
    Function throw → 500 `dispatch_failed`.
11. `host.dispatch(envelope)`, then await `handle.accepted`. A
    `ConcurrencyRejectedError`, which rejects `accepted` when the flow's
    `request.concurrency` is `"reject"` on a key the scheduled envelope
    carries (e.g. `user`) and a competing run holds it, returns 200
    `{ status: "skipped", reason: "in_flight" }` with the winner's
    `requestId`, the same shape as the step-8 overlap skip so the
    scheduler does not retry. A throw from `dispatch` itself → 503
    `flow_unregistered`; any other rejection of `accepted` → 503
    `dispatch_failed`. Every fire that isn't admitted (these, and an
    input function that throws) gives its time back, version-checked
    against its own claim: a later time claimed since keeps its record.
12. Return 202 with `requestId`, `scheduleId`, `origin`.

**Auth runs before the claim.** Authenticating before anything reads the
fired record keeps an unauthenticated caller from probing dispatch
history: a duplicate would answer 200 `{ status: "duplicate" }` while an
unseen time answered 401, and that difference is a response oracle over
which schedules have already fired. Adapter authors reimplementing this
path must preserve the ordering.

The envelope sets `responseEmitter: null`. `signal` is omitted —
the scheduler closes the connection on 202.

Skip is best-effort. The claim holds across processes on stores with
compare-and-set across processes (SQLite, Postgres); on the memory
store and the filesystem store, whose lock is per instance, it holds
within one process. It can't cover two independent schedulers where
one is told `duplicate` and the other's claim is then given back on a
503. See the
[user guide](../../apps/docs/docs/server/scheduled.md#at-most-once-per-scheduled-time).

## Two-phase auth

- **Gateway principal** — `host.resolvePrincipal`. Proves the caller
  is the trusted scheduler.
- **Schedule principal** — `schedule.principal`. The target user.

Runtime uses `schedule.principal ?? gatewayPrincipal`.
`createBearerSecretPrincipalResolver` is the canonical gateway
helper. Compose with HTTP auth by branching on `ctx.source`.

## Store usage

No new store query primitives. The adapter uses
`host.registry.get`, `activeRequests.listAll` (via
`findScheduledRequest`), `resourceState.get` inside the resource-collection
resolver, `resourceState.get`/`set`/`delete` on the one fired record per
schedule (the only thing the adapter writes), and `host.dispatch`. It never lists resources across users
— the engine's tick finds due ids: static ones from the flow's config,
dynamic ones from the flow's `ScheduleIndex`.

`findScheduledRequest` lives in `@flow-state-dev/scheduled`, not on
`ActiveRequestRegistry`. Promoting it to a registry method is a
non-breaking follow-up if the scan is hot.

## Envelope construction

```ts
const envelope: InboundRequestEnvelope = {
  source: "scheduled",
  flowKind,
  action: schedule.block.name, // provenance only
  input,
  principal: effectivePrincipal,
  metadata: {
    schedule: {
      scheduleId,
      origin, // "static" | "dynamic"
      cron: schedule.cron,
      nominalFireTime,
      dispatchedAt: new Date().toISOString(),
      timezone: schedule.timezone ?? "UTC"
    }
  },
  resolvedActionCore: origin === "dynamic" ? schedule : undefined,
  responseEmitter: null,
};
```

`action` is never used to resolve the handler. Static schedules
resolve through `resolveActionCore` via
`metadata.schedule.scheduleId` gated on `source === "scheduled"`
(see [Action forms](./action-forms.md)). Dynamic schedules carry
`resolvedActionCore` on the envelope; that field is not persisted.
A durable dynamic run mid-crash cannot re-resolve its handler, so
the run is dropped. If a durable scheduled action must survive a
crash, make it static.

## Listing

`GET /api/flows/:flowKind/schedules` returns the static schedules as
an **array** — the `static` config record is flattened, with each key
becoming the entry's `id` — plus `dynamic.provided` when a resolver is
wired:

```json
{
  "static": [
    {
      "id": "monthly-invoices",
      "cron": "0 0 1 * *",
      "action": "generate-invoices",
      "timezone": "UTC",
      "description": "Bill every active account",
      "enabled": true
    }
  ],
  "dynamic": { "provided": true }
}
```

`action` holds the handler block's `name` — provenance for the
listing, not a resolver key. `description` is omitted when the
schedule declares none. Dynamic schedules live in host-owned storage and
are not enumerated. The route goes through `host.resolvePrincipal`
and respects `requireUser`.

## Error response codes

| Code | Reason |
| --- | --- |
| 202 | Accepted; action dispatched |
| 200 | `duplicate` (the time, or a later one, already fired; `reason: "stale"` for a time more than a period old) or `skipped` (overlap, or a concurrency `reject` at dispatch) |
| 400 | `invalid_schedule_id` (URL pattern), `invalid_schedule` (resolved data, a cron not five fields, an unknown zone), `not_a_scheduled_time`, `not_yet_due`, `invalid_nominal_fire_time`, or `idempotency_key_removed` |
| 401 | `unauthorized` (gateway-auth failure) |
| 404 | `flow_not_found` or `schedule_not_found` |
| 405 | Method not allowed (POST is required on dispatch) |
| 500 | `resolver_failed` (resolver threw) or `dispatch_failed` (input fn threw) |
| 503 | `flow_unregistered` (unregistered between resolve and dispatch) |

## The tick

One tick in the engine (`packages/engine/src/execution/schedule-tick.ts`)
fires every schedule of every registered flow, through this endpoint:

- **Static** (`schedules.static`): each enabled schedule's latest scheduled
  time, in its timezone, after the last tick and at or before now.
- **Dynamic** (`schedules.index`): `claimDue` on each flow's index, one index
  once (its entries name no flow, so an index two flows name is ticked once).
  Each entry fires under its `formatScheduleId` id (from core) for its latest
  due time, from the `cron` and `timezone` the entry carries. An entry with no
  org is dropped and logged.

So after downtime each schedule fires once, late, for the latest time it
missed; earlier missed times are dropped. "The last tick" is one record in the
app's resource state, written only by the tick; with none, a first tick looks
back one interval, so a schedule added today never fires a time long past.
The tick throws only when a claim does, after firing everything else. The
endpoint's claim is still the at-most-once guarantee; the tick only finds what
is due.

**When it runs** is the `createFlowState({ scheduler })` option, and each
scheduler only calls `ScheduleTicker.tick`:

- **Omitted: the local cron** (`execution/local-scheduler.ts`). Each minute,
  in a process that builds the router (`ready()`, `getRouter()`, `serve()`,
  `fsdev dev`) or starts a job queue's processing, and only when a registered
  flow declares a static schedule or an index. Never in a process that only
  resolves the runtime (`fsdev run`, `chat`, `block`). It ticks only while it
  holds a lease on `stores.leases` (its own sentinel key, two intervals long,
  renewed every half lease on its own timer, released on dispose), so one
  process ticks across a deployment that shares its store; a crash hands over
  within three minutes. In production on in-memory or filesystem stores it
  warns at start: their lease can't keep a second server from ticking. The
  tick dispatches through the app's own router, bearing `CRON_SECRET` when
  set; a `process-only` job-queue process gives that router the queue's
  runner, so a fire is enqueued like any action.
- **`vercelScheduler()`** (`@flow-state-dev/vercel`): no process stays up, so
  one Vercel Cron entry calls its `route`. The route checks the bearer
  secret (constant-time; an empty secret refuses all), ticks with the
  request's origin as `baseUrl` so each fire is its own request to the
  deployment, and answers 500 when the tick throws so the next beat retries.
  On Vercel with the local default, startup warns to pass it.
- **`false`**: nothing fires the tick.

A flow that declares a static schedule or an index with no scheduled
transport mounted fails `ready()`, naming the line to add.

`schedules.index` is a structural `{ claimDue(now, limit) }` in core, so a
flow carries its index without core loading this package.

Subscription polling (`defineSubscriptionServiceFlow({ poll })` in
`@flow-state-dev/workforce`) is the first flow to carry one: one schedule resource
per user and thread at `workforce/subscription-polls/*`, firing at that
user's fastest subscription's cadence (5, 10, 15, 20, 30 or 60 minutes).

## v1 non-goals

- No fan-out. One dispatch fires one action.
- No missed-window replay: after downtime a schedule fires once, for the
  latest time it missed.
- No `onOverlap: "queue"`.
- No bundled `node-cron` integration.
- No per-action authentication overrides for scheduled dispatch.
- No `ScheduleConfig.maxRuntimeMs`.
- No cross-tenant enumeration of dynamic schedules.

## Related

- [Action forms](./action-forms.md) — `ActionCore`, `resolveActionCore`,
  carried-core for dynamic schedules.
- [Inbound Transports](./inbound-transports.md) —
  `InboundTransportAdapter`.
- [Authentication](./authentication.md) — `resolvePrincipal` at the
  adapter boundary.
- [`@flow-state-dev/scheduled` README](../../packages/scheduled/README.md)
- [Scheduled actions](../../apps/docs/docs/server/scheduled.md) —
  install, mounting, examples, the Vercel route.
