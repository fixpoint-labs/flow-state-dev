# Scheduled Actions Adapter

`@flow-state-dev/scheduled` (FIX-440) exposes a flow's actions to an
external scheduler over HTTPS. It is the third concrete
`InboundTransportAdapter` after the built-in HTTP adapter and
`@flow-state-dev/mcp` — see [Inbound Transports](./inbound-transports.md)
for the contract it conforms to.

The runtime below the adapter is identical to HTTP. `host.dispatch`
runs the action; `RequestRecord.source = "scheduled"` carries
provenance through to DevTool, where scheduled-originated requests
render with a schedule-id label and an origin badge
(`static` / `dynamic`).

The framework owns the dispatch contract, validation, two-phase auth,
and provenance metadata. The host owns the actual scheduler (Vercel
Cron, Cloud Scheduler, EventBridge, GitHub Actions, `node-cron`) and
any storage that backs dynamic schedules. The framework does not run
a cron daemon, retry queue, or scheduler loop.

## Endpoint shape

One dispatch route and one listing route per flow:

```
POST /api/flows/:flowKind/schedules/:scheduleId/dispatch
GET  /api/flows/:flowKind/schedules
```

`GET` and `DELETE` on the dispatch path return 405. POST on the
listing path returns 405. POST is required on dispatch so the body
can carry `nominalFireTime` and `idempotencyKey` and so auth flows
through `Authorization` rather than query strings.

## The `schedules` config block

`schedules` is a resolution surface, not a flat record. Added to
`FlowDefinition` alongside `mcp?: McpConfig`:

```ts
type SchedulesConfig = {
  static?: Record<string, ScheduleConfig>;
  resolve?: (
    scheduleId: string,
    ctx: ScheduleResolutionContext
  ) => Promise<ScheduleConfig | null> | ScheduleConfig | null;
};

type ScheduleConfig = {
  cron: string;                  // POSIX 5-field, validated, display-only
  action: string;                // must exist on flow.actions
  input?: unknown | ScheduleInputFn;
  principal?: ResolvedPrincipal; // target user (wins over gateway principal)
  timezone?: string;             // opaque metadata; framework does not interpret
  onOverlap?: "skip" | "allow";  // default "skip"
  description?: string;
  enabled?: boolean;             // default true
};
```

A flow can ship both `static` (the simple framework cron-job case)
and `resolve` (dynamic per-user, per-record, agent-created
schedules). Static lookup runs first; the resolver is consulted only
when `static[id]` is absent. Static wins by design — it lets a host
override a single dynamic schedule by adding it statically without
changing the resolver.

## Validation

Two passes — registration time for the static map, dispatch time for
everything resolved dynamically.

`validateScheduleConfig` is exported from `@flow-state-dev/core` and
runs in both paths. The function checks:

- Schedule id pattern. Static ids: `^[a-z0-9][a-z0-9-]{0,63}$`.
  Dynamic ids carry composite shapes (e.g. `<userId>/<key>`) and use
  the wider URL-safe pattern `^[a-z0-9][a-z0-9:/_-]{0,127}$`. The
  dispatch route validates the URL pattern before any resolver call.
- Action exists on `flow.actions`.
- Cron parses under `cron-parser` (POSIX 5-field).
- Static `input` matches the action's `inputSchema`. Dynamic input
  defers to runtime — the resolver returns whatever the host stored,
  and validation happens against the action schema during dispatch.
- `onOverlap` is `"skip"` or `"allow"`. `"queue"` is a reserved enum
  value not implemented in v1 (requires durable queueing).
- `principal.userId` is a non-empty string when the field is set.

Validation failures at registration throw synchronously from
`createFlowInstance`. Validation failures at dispatch return 400
`invalid_schedule` — the host's stored data is broken and a human
needs to fix it.

`cron-parser` is a `@flow-state-dev/core` dependency. Validation runs
once per registration and once per dynamic resolution; never inside a
hot loop.

## Dispatch flow

`handleDispatch` in `routes.ts` runs in a fixed order:

1. Validate the URL `scheduleId` against the dynamic-id pattern.
   Cheap; precedes any I/O.
2. Resolve flow from the registry. Unknown flow → 404.
3. Parse the body (small; both fields optional). Preserved as
   `rawBody` for resolvers that want to verify a body signature.
4. Idempotency dedupe. The cache key is `body.idempotencyKey ?? "${scheduleId}:${nominalFireTime ?? ""}"`.
   A hit within the configured window (default 60s) returns 200
   `{ status: "duplicate" }` without invoking the action.
5. Gateway auth. Calls `host.resolvePrincipal({ source: "scheduled", … })`.
   For dynamic schedules, this happens *before* the resolver runs so
   resolvers can trust the caller. The principal returned here is
   the *gateway* principal — not necessarily the action's effective
   principal.
6. Schedule resolution. Static lookup first: `flow.schedules?.static?.[scheduleId]`.
   On miss, call the dynamic resolver with `(scheduleId, { flowKind,
   gatewayPrincipal, request, stores })`. `null` from the resolver →
   404 `schedule_not_found`. Throw → 500 `resolver_failed`.
7. `validateScheduleConfig({ origin: "dynamic", … })` against whatever
   the resolver returned. Failures → 400 `invalid_schedule`.
8. Overlap policy. If `onOverlap !== "allow"`, scan `host.stores.activeRequests.listAll()`
   via `findScheduledRequest` for an in-flight scheduled request with
   matching `(flowKind, source, metadata.scheduleId)`. A match → 200
   `{ status: "skipped", reason: "in_flight" }`.
9. Effective principal: `schedule.principal ?? gatewayPrincipal`.
   Static schedules typically rely on the gateway fallback; dynamic
   schedules almost always set `principal` explicitly.
10. Resolve input. Static value or call `schedule.input(ctx)` if it's
    a function. Function throws → 500 `dispatch_failed`.
11. Build envelope and call `host.dispatch(envelope)`. Synchronous
    throw from the host (e.g. flow unregistered between resolve and
    dispatch) → 503 `flow_unregistered`.
12. Record idempotency key. Return 202 with `requestId`, `scheduleId`,
    `origin`.

The envelope sets `responseEmitter: null` (fire-and-forget; no
streaming consumer). `signal` is intentionally omitted — the
scheduler closes its connection the moment it gets the 202, and
inbound wire-level signal aborts would tear down legitimate work.

## Two-phase auth

Two principals flow through the dispatch:

- **Gateway principal** — established at step 5 by
  `host.resolvePrincipal`. Proves the caller is the trusted scheduler.
  Typically a system principal like `{ userId: "system" }`. Backed by
  the shared scheduler secret in the canonical setup.
- **Schedule principal** — the *target* user. Carried on
  `schedule.principal`. Per-user dynamic schedules synthesize it from
  the schedule's owner (the resource-collection helper does this from
  the resource's owning user scope). Static framework-level schedules
  usually omit it and fall back to the gateway principal.

The runtime uses `schedule.principal ?? gatewayPrincipal` as the
effective principal during dispatch. So a dynamic resolver returning
`{ principal: { userId: "u_abc" } }` runs the action as `u_abc`
even though the dispatch was authenticated against the system
scheduler secret.

`createBearerSecretPrincipalResolver` (exported from
`@flow-state-dev/server`) is the canonical helper for the gateway
phase. It does a constant-time comparison via `crypto.timingSafeEqual`
on `Authorization: Bearer <secret>` and returns the configured
`ResolvedPrincipal` on match. Composing with HTTP auth uses
`ctx.source` branching:

```ts
resolvePrincipal: async (ctx) => {
  if (ctx.source === "scheduled") return verifyScheduleSecret(ctx);
  return verifyJwtFromHeader(ctx);
}
```

## Store usage

The adapter consumes the existing `StoreRegistry` interface
unchanged. No new store query primitives:

- `host.registry.get(flowKind)` for flow lookup.
- `host.stores.activeRequests.listAll()` via `findScheduledRequest`
  for the overlap scan. The helper filters in user-space; for v1 the
  cardinality of in-flight scheduled requests is tiny (typically 0–1
  per running schedule), so a scan is correct without backend
  indexing. If the scan turns out to be hot in production,
  promoting it to a dedicated `ActiveRequestRegistry.findScheduled`
  method with backend-specific indexes is a non-breaking follow-up.
- `host.stores.resources.read(userScope(userId), key)` inside
  `createResourceCollectionScheduleResolver`. Existing primitive;
  no new "list across users" surface is introduced.
- `host.dispatch(envelope)` for the runtime call.

The deliberately-avoided primitive is "list resources across all
users." That primitive is not needed because the host's scheduler
(Cloud Scheduler, EventBridge, the polling loop) tracks which
schedules to fire and dispatches one at a time by id. The framework
only ever does `read(userId, key)` lookups.

## Envelope construction

```ts
const envelope: InboundRequestEnvelope = {
  source: "scheduled",
  flowKind,
  action: schedule.action,
  input,
  principal: effectivePrincipal,
  metadata: {
    scheduleId,
    origin,                  // "static" | "dynamic"
    cron: schedule.cron,
    nominalFireTime,
    dispatchedAt: new Date().toISOString(),
    timezone: schedule.timezone ?? "UTC"
  },
  responseEmitter: null,
  // signal intentionally omitted
};
```

All seven `metadata` fields land on the `RequestRecord` and are
visible to lifecycle hooks, middleware, the items log, and DevTool's
provenance panel.

## DevTool surface

The DevTool renders `source` as a small chip on every request row.
For scheduled requests it appends `· {scheduleId}` (truncated to 32
characters) and a small `static` / `dynamic` origin badge. The
detail view has a Provenance section showing `source`, `origin`, and
the rest of `metadata` pretty-printed.

No new DevTool tab in v1. Schedule listings, run history, and
human-readable cron descriptions are deferred — `RequestRecord` is
the audit trail, and the listing endpoint covers operational
visibility.

## Idempotency cache

A per-process LRU keyed on `(flowKind, dedupeKey)` with TTL.
`dedupeKey = body.idempotencyKey ?? "${scheduleId}:${nominalFireTime ?? ""}"`.
Default window 60_000 ms; configurable via
`createScheduledTransportAdapter({ idempotencyWindowMs })`. Set to 0
to disable.

The cache is in-memory and per-process. Multi-process deployments
either rely on the host scheduler's own idempotency (Cloud Scheduler
and EventBridge dedupe at-least-once delivery on their side) or
front the adapter with a shared cache. v1 does not ship distributed
dedupe.

Empty bodies fall through to a `${scheduleId}:` dedupe key, which
collapses concurrent ticks for the same schedule to one. This is the
right default for schedulers that don't set `nominalFireTime` —
better than letting concurrent identical fires both run.

## Overlap policy

`onOverlap: "skip"` (default) consults `findScheduledRequest`. Match
→ 200 `{ status: "skipped", reason: "in_flight", requestId }` with
no dispatch.

`onOverlap: "allow"` proceeds unconditionally. Concurrent runs are
permitted; no skip.

Skip is best-effort. Two ticks within a few milliseconds can both
pass the in-flight check before either calls `host.dispatch`, and
both proceed. The framework-side idempotency cache catches the
duplicate when both ticks carry the same `nominalFireTime`. For
exactly-once semantics within a tight window, lean on the host
scheduler's own idempotency (which is the authoritative source for
duplicate detection in multi-process deployments anyway).

## `findScheduledRequest`

```ts
async function findScheduledRequest(
  registry: ActiveRequestRegistry,
  flowKind: string,
  scheduleId: string
): Promise<ActiveRequestEntry | null> {
  const all = await registry.listAll();
  return all.find(
    (entry) =>
      entry.flowKind === flowKind &&
      entry.source === "scheduled" &&
      (entry.metadata as Record<string, unknown> | undefined)?.scheduleId === scheduleId
  ) ?? null;
}
```

Lives in `@flow-state-dev/scheduled`, not on the
`ActiveRequestRegistry` interface. Reasons in the FIX-440 spec: v1
cardinality is tiny, every backend already implements `listAll`, and
adding a method to the registry interface forces churn across four
first-party stores plus any custom adapters. The helper-only
approach is non-breaking and works against in-memory, filesystem,
SQLite, and Postgres registries with zero per-store changes.

If profiling shows the scan is hot in production, promotion to a
dedicated `findScheduled` method on the registry interface is a
non-breaking follow-up. SQLite and Postgres can back it with a
partial index on `source = 'scheduled'` plus a JSON-extract on
`metadata.scheduleId`. Documented in the FIX-440 spec for the
follow-up.

## Listing endpoint

`GET /api/flows/:flowKind/schedules` returns:

```json
{
  "static": [
    { "id", "cron", "timezone", "action", "description", "enabled" }
  ],
  "dynamic": { "provided": true }
}
```

Static enumeration only. Dynamic schedules live in host-owned
storage and are not the framework's to enumerate — the host's own
UI surfaces those, since it owns the storage primitive ("list all my
schedules") needed to do it correctly.

The endpoint runs through `host.resolvePrincipal` and respects the
flow's `requireUser` setting. Cron strings and action names are
operationally sensitive; the listing endpoint is auth-gated like
every other route.

## Reference helper: resource-collection-backed dynamic schedules

`createResourceCollectionScheduleResolver` wires dynamic schedules
backed by a flow-state resource collection in one line:

```ts
schedules: {
  resolve: createResourceCollectionScheduleResolver({
    collection: userSchedules,
    // parseId / formatId are optional; default is "<userId>/<key>"
  })
}
```

Internally on `resolve(scheduleId, ctx)`:

1. Parse `scheduleId` into `(userId, collectionKey)`.
2. Read `ctx.stores.resources.read(userScope(userId), "schedules/" + collectionKey)`.
   Absent → return `null`.
3. Synthesize `principal: { userId }` from the resource's owning user
   scope.
4. Return the `ScheduleConfig`.

The helper guards URL-driven impersonation. If the parsed `userId`
doesn't match the resource's owning user, the helper returns `null`
(404) and logs a warning. Custom resolvers must implement the
equivalent check themselves — the framework can't do it for arbitrary
ID schemes because it doesn't know how the id maps to ownership.

## Adapter mounting

Mounted alongside any other adapters via `createFlowApiRouter`:

```ts
import { createFlowApiRouter } from "@flow-state-dev/server";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";

const router = createFlowApiRouter({
  registry,
  stores,
  adapters: [createScheduledTransportAdapter()]
});
```

Path collisions with other adapters (e.g. a custom adapter mounting
the same path) throw `TransportRouteCollisionError` at construction
(the FIX-438 contract).

## Error response codes

| Code | Reason |
| --- | --- |
| 202 | Accepted; action dispatched |
| 200 | `duplicate` (idempotency hit) or `skipped` (overlap) |
| 400 | `invalid_schedule_id` (URL pattern) or `invalid_schedule` (resolved data) |
| 401 | `unauthorized` (gateway-auth failure) |
| 404 | `flow_not_found` or `schedule_not_found` |
| 405 | Method not allowed (POST is required on dispatch) |
| 500 | `resolver_failed` (resolver threw) or `dispatch_failed` (input fn threw) |
| 503 | `flow_unregistered` (unregistered between resolve and dispatch) |

## v1 non-goals

- No fan-out. One dispatch fires one action.
- No framework-side scheduler loop. Hosts wire their own.
- No durable missed-window handling (deferred to FIX-141 durable
  execution).
- No `onOverlap: "queue"` (reserved; requires durable queueing).
- No time-zone-aware cron evaluation. `timezone` is opaque metadata.
- No bundled `node-cron` integration.
- No `cronstrue` description rendering in DevTool.
- No per-action authentication overrides for scheduled dispatch.
- No `ScheduleConfig.maxRuntimeMs` per-schedule timeout.
- No cross-tenant enumeration of dynamic schedules.

## Related

- [Inbound Transports](./inbound-transports.md) — the
  `InboundTransportAdapter` contract.
- [MCP Server](./mcp-server.md) — package layout precedent
  (FIX-22 / `@flow-state-dev/mcp`).
- [Authentication](./authentication.md) — `resolvePrincipal` hook
  used at the adapter boundary.
- [`@flow-state-dev/scheduled` README](../../packages/scheduled/README.md) —
  install, usage, public exports.
- `apps/docs/docs/server/scheduled.md` — public reference guide.
- `apps/docs/guides/scheduled-vercel-cron.md`,
  `scheduled-cloud-scheduler.md`, `scheduled-eventbridge.md`,
  `scheduled-dynamic.md` — host-side integration guides.
