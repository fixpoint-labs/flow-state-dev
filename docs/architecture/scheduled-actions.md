# Scheduled Actions Adapter

`@flow-state-dev/scheduled` exposes a flow's actions to an external
scheduler over HTTPS. It is a concrete `InboundTransportAdapter` —
see [Inbound Transports](./inbound-transports.md) for the contract.

`host.dispatch` runs the action. `RequestRecord.source = "scheduled"`
carries provenance. The framework owns the dispatch contract,
validation, two-phase auth, and provenance metadata. The host owns
the scheduler and any storage that backs dynamic schedules. The
framework does not run a cron daemon, retry queue, or scheduler loop.

Install, mounting, static/dynamic examples, and host-scheduler
walkthroughs live in
[Scheduled actions](../../apps/docs/docs/server/scheduled.md).

## Endpoint shape

```
POST /api/flows/:flowKind/schedules/:scheduleId/dispatch
GET  /api/flows/:flowKind/schedules
```

`GET` and `DELETE` on the dispatch path return 405. POST on the
listing path returns 405. POST is required on dispatch so the body
can carry `nominalFireTime` and `idempotencyKey` and so auth flows
through `Authorization` rather than query strings.

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
- Cron parses under `cron-parser` (POSIX 5-field). `timezone` is
  opaque metadata; the framework does not evaluate it.
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
5. Idempotency dedupe. Key is
   `body.idempotencyKey ?? "${scheduleId}:${nominalFireTime ?? ""}"`.
   A hit in the window (default 60s) returns 200 `{ status: "duplicate" }`.
6. Resolve the schedule: `static[id]`, else `resolve(...)`.
   `null` → 404 `schedule_not_found`. Throw → 500 `resolver_failed`.
7. `validateScheduleConfig({ origin: "dynamic", … })`.
   Fail → 400 `invalid_schedule`.
8. Overlap. If `onOverlap !== "allow"`,
   `findScheduledRequest` scans in-flight scheduled requests for
   `(flowKind, source, metadata.schedule.scheduleId)`. Match → 200
   `{ status: "skipped", reason: "in_flight" }`. The helper still
   dual-reads legacy top-level `metadata.scheduleId` (FIX-850).
9. Effective principal: `schedule.principal ?? gatewayPrincipal`.
10. Resolve input (static value or `schedule.input(ctx)`).
    Function throw → 500 `dispatch_failed`.
11. `host.dispatch(envelope)`. A `ConcurrencyRejectedError` — thrown
    when the flow's `request.concurrency` is `"reject"` on a key the
    scheduled envelope carries (e.g. `user`) and a competing run holds
    it — returns 200 `{ status: "skipped", reason: "in_flight" }` with
    the winner's `requestId`, the same shape as the step-8 overlap skip
    so the scheduler does not retry. Any other host throw → 503
    `flow_unregistered`.
12. Record the idempotency key. Return 202 with `requestId`,
    `scheduleId`, `origin`.

**Steps 4 and 5 are in that order deliberately.** Authenticating before
the dedupe check keeps an unauthenticated caller from probing dispatch
history: if dedupe ran first, a duplicate key would answer 200
`{ status: "duplicate" }` while an unseen one answered 401, and that
difference is a response oracle over which schedules have already fired.
Adapter authors reimplementing this path must preserve the ordering.

The envelope sets `responseEmitter: null`. `signal` is omitted —
the scheduler closes the connection on 202.

Skip and the in-memory idempotency cache are best-effort and
per-process. Multi-process hosts lean on the scheduler's own
dedupe, or a shared cache. See the
[user guide](../../apps/docs/docs/server/scheduled.md#overlap-policy).

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
`findScheduledRequest`), `content.get` inside the resource-collection
resolver, and `host.dispatch`. It never lists resources across users
— the host scheduler tracks which ids to fire.

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

`GET /api/flows/:flowKind/schedules` returns the static map plus
`{ dynamic: { provided: true } }` when a resolver is wired. Dynamic
rows live in host-owned storage and are not enumerated. The route
goes through `host.resolvePrincipal` and respects `requireUser`.

## Error response codes

| Code | Reason |
| --- | --- |
| 202 | Accepted; action dispatched |
| 200 | `duplicate` (idempotency hit) or `skipped` (overlap, or a concurrency `reject` at dispatch) |
| 400 | `invalid_schedule_id` (URL pattern) or `invalid_schedule` (resolved data) |
| 401 | `unauthorized` (gateway-auth failure) |
| 404 | `flow_not_found` or `schedule_not_found` |
| 405 | Method not allowed (POST is required on dispatch) |
| 500 | `resolver_failed` (resolver threw) or `dispatch_failed` (input fn threw) |
| 503 | `flow_unregistered` (unregistered between resolve and dispatch) |

## v1 non-goals

- No fan-out. One dispatch fires one action.
- No framework-side scheduler loop.
- No durable missed-window handling.
- No `onOverlap: "queue"`.
- No time-zone-aware cron evaluation.
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
  install, mounting, examples, host-scheduler guides.
