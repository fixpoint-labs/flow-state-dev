# Scheduled Actions Adapter

`@flow-state-dev/scheduled` lets an **external** scheduler fire a flow's schedules over HTTPS, as an `InboundTransportAdapter` with `source: "scheduled"`. The framework owns the dispatch contract, validation, auth and provenance; the host owns the scheduler and any dynamic-schedule storage. There is no framework cron loop, retry queue or missed-window handling. Config, mounting, examples and the response codes are user-facing: [Scheduled actions](../../apps/docs/docs/server/scheduled.md), [package README](../../packages/scheduled/README.md).

Routes: `POST /api/flows/:flowKind/schedules/:scheduleId/dispatch` (POST so the body carries `nominalFireTime` / `idempotencyKey` and auth uses a header), `GET /api/flows/:flowKind/schedules` (static entries only; dynamic rows are host-owned and never enumerated).

## Resolution and validation

- A `ScheduleConfig` is `ActionCore` + `cron` and friends: an action in scheduled form with **no `flow.actions` entry and no caller surface**. The `action` recorded and listed is the block's `name`, provenance only.
- `static[id]` is checked first, `resolve(id, ctx)` only on a miss, so a host can override one dynamic schedule statically.
- `validateScheduleConfig` runs at registration for static entries (throws from `createFlowInstance`) and at dispatch for resolver output (400 `invalid_schedule`). Static ids `^[a-z0-9][a-z0-9-]{0,63}$`; dynamic ids `^[a-z0-9][a-z0-9:/_-]{0,127}$`, checked against the URL before any resolver call. `timezone` is opaque metadata; cron is not evaluated. `onOverlap: "queue"` is reserved.
- Static schedules re-resolve on recovery through `metadata.schedule.scheduleId` (gated on `source`). **Dynamic schedules carry `resolvedActionCore`, which isn't persisted, so a durable dynamic run interrupted by a crash is dropped.** See [Action Forms](./action-forms.md#dynamic-schedules-carry-their-core-so-they-dont-recover).

## Dispatch order

1. Validate the URL id; resolve the flow (404).
2. Parse the body, keeping `rawBody` for signature-checking resolvers.
3. **Gateway auth** via `host.resolvePrincipal({ source: "scheduled" })`, before the resolver.
4. **Idempotency**: key `idempotencyKey ?? "${scheduleId}:${nominalFireTime ?? ""}"`; a hit within the window (60 s) → 200 `duplicate`.
5. Resolve and validate the schedule.
6. Overlap: unless `onOverlap: "allow"`, `findScheduledRequest` scans in-flight requests for `(flowKind, source, metadata.schedule.scheduleId)` (still dual-reading legacy top-level `metadata.scheduleId`) → 200 `skipped`.
7. Effective principal `schedule.principal ?? gatewayPrincipal`; resolve input.
8. `host.dispatch` with `responseEmitter: null` and no `signal` (the scheduler disconnects on 202). A `ConcurrencyRejectedError` returns the same 200 `skipped` shape as step 6, so the scheduler doesn't retry.
9. Record the idempotency key; 202.

**Auth precedes dedupe deliberately.** Otherwise a duplicate key answers 200 while an unseen one answers 401, a response oracle over which schedules have fired. Reimplementations must keep this order.

**Two-phase auth:** the gateway principal proves the caller is the trusted scheduler (`createBearerSecretPrincipalResolver`); `schedule.principal` is the user the action runs as.

Overlap skip and the idempotency cache are **per-process, best-effort**; multi-process hosts rely on the scheduler's own dedupe or a shared cache. The adapter adds no store primitives and never lists resources across users.
