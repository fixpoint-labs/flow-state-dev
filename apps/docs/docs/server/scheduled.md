---
sidebar_position: 4
---

# Scheduled actions

`@flow-state-dev/scheduled` adds a dispatch endpoint that lets an
external scheduler invoke a flow action on a schedule. The framework
owns the dispatch contract, validation, two-phase auth, and provenance.
The host owns the actual scheduler (Vercel Cron, Cloud Scheduler,
EventBridge, GitHub Actions, `node-cron`) and any storage that backs
dynamic schedules.

There are two kinds of schedules:

- **Static** — declared in flow source as a typed map. Useful for
  framework-level cron jobs like a daily digest or a nightly cleanup.
- **Dynamic** — looked up at dispatch time by a resolver hook. Useful
  for per-user reminders, per-record alerts, and follow-ups an agent
  decides to schedule at runtime. Definitions live in a host-owned
  store (a flow-state resource collection, a database table, an
  external service); the framework never owns schedule storage.

A flow can ship both at once.

## Install

```bash
pnpm add @flow-state-dev/scheduled
```

## Mounting the adapter

The scheduled adapter is just another entry in `adapters` on
[`createFlowState`](./setup.md), the canonical setup entrypoint:

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";

export const flowstate = createFlowState({
  flows: { billing: billingFlow },
  stores: { default: { primary: inMemoryStores() } },
  adapters: [createScheduledTransportAdapter()],
});
```

Turn the handle into route handlers with a platform handler — the
dispatch endpoint mounts under the same router:

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
```

Mounted alongside any other adapters. The HTTP adapter is always
mounted; MCP, webhooks, and scheduled coexist on the same router.

## Static schedules

A static schedule is a record on the flow's `schedules.static` map.
Each entry carries its handler inline (the shared action core) instead
of naming an entry in `flow.actions`. Same model the webhook and chat
transports use. Cron strings and input shapes are validated when the
flow is registered, so a malformed cron or a bad input shape surfaces
at boot, not at dispatch.

```ts
import { defineFlow, defineScheduleBinding } from "@flow-state-dev/core";

defineFlow({
  kind: "billing",
  schedules: {
    static: {
      "monthly-invoices": defineScheduleBinding({
        cron: "0 0 1 * *",
        block: generateMonthlyInvoices,
        description: "First of the month, 00:00 UTC"
      })
    }
  }
});
```

`defineScheduleBinding` is the schedule sibling of `defineWebhookBinding`
and `defineChatBinding`. It's a compile-time convenience — a plain object
literal works too. A schedule handler lives only on `schedules.static`,
so it has no HTTP or MCP caller surface; declare a block in both
`schedules.static` and `flow.actions` (same reference) if you want it
reachable both ways.

Cron strings are POSIX 5-field: `minute hour day-of-month month day-of-week`.
The framework validates the syntax but does not run the schedule. The
host's scheduler decides when to fire and POSTs the dispatch endpoint
at the right time.

## Dynamic schedules

A dynamic schedule is resolved at dispatch time by the
`schedules.resolve` hook. The hook receives the schedule id from the
URL and returns a `ScheduleConfig` (or `null` to 404 the dispatch).
The config carries the handler block inline, the same as a static
entry.

A block can't be serialized into a stored row, so the persisted record
keeps a `kind` discriminator string instead. The resolver maps that
`kind` back to a real block. The `createResourceCollectionScheduleResolver`
helper takes a `blocks` map for exactly this:

```ts
import { createResourceCollectionScheduleResolver } from "@flow-state-dev/scheduled";

defineFlow({
  kind: "reminders",
  schedules: {
    resolve: createResourceCollectionScheduleResolver({
      collection: schedulesCollection,
      blocks: { sendDigest, sendReminder }   // persisted `kind` → block
    })
  }
});
```

Writing the resolver by hand follows the same shape: read the row, look
the block up by its `kind`, and return the config. An unknown `kind`
returns `null` (404).

```ts
resolve: async (scheduleId, ctx) => {
  const row = await db.schedules.findById(scheduleId);
  if (!row || !row.enabled) return null;
  const block = blocks[row.kind];
  if (!block) return null;
  return {
    cron: row.cron,
    block,
    input: row.input,
    principal: { userId: row.userId }
  };
}
```

The host backs the resolver with whatever store fits. For schedules
held in a flow-state resource collection, the
[dynamic schedules guide](/guides/scheduled-dynamic) covers the
reference helper and end-to-end wiring. For SQL or external services,
write the resolver directly.

### Durable dynamic schedules don't recover across crashes

A dynamic schedule's action core is produced by the resolver at
dispatch time and carried on the dispatch envelope. It's never
persisted — a block can't be serialized, and the stored row holds only
the `kind` discriminator. So if a durable dynamic schedule is mid-run
when the process crashes, there's no persisted coordinate to re-resolve
the handler from, and the run is not recovered.

Static schedules don't have this problem. Their handler is reachable
from a stable coordinate (`schedules.static[scheduleId]`), so a durable
static schedule recovers normally. If you need crash recovery for a
durable scheduled action, make it static.

## Effective principal

A scheduled action runs as the principal returned by the schedule, not
as the caller that hit the dispatch endpoint. Two principals are at
play:

- **Gateway principal** — established by `authentication.resolvePrincipal`
  when the dispatch endpoint is hit. Proves the caller is the trusted
  scheduler. Typically a system principal like `{ userId: "system" }`.
- **Schedule principal** — `schedule.principal` on the resolved
  config. The *target* user the action runs as. Per-user reminders set
  this to the owning user; static framework-level schedules usually
  omit it.

The runtime uses `schedule.principal ?? gatewayPrincipal`. So a
dynamic resolver that returns `{ principal: { userId: "u_abc" } }`
runs the action as `u_abc`, even though the dispatch was authenticated
as the system scheduler.

## The dispatch endpoint

```
POST /api/flows/:flowKind/schedules/:scheduleId/dispatch
```

Body fields are optional:

```json
{
  "nominalFireTime": "2026-06-01T09:00:00Z",
  "idempotencyKey": "weekly-digest-2026-06-01"
}
```

Response codes:

| Code | Meaning |
| ---- | ------- |
| 202  | Accepted — action was dispatched |
| 200  | `duplicate` (idempotency hit) or `skipped` (overlap policy) |
| 400  | Schedule id pattern invalid, or resolved schedule is malformed |
| 401  | Gateway auth failed |
| 404  | Flow or schedule not found |
| 405  | Wrong method (only POST is supported) |
| 500  | Resolver threw, or input function threw |
| 503  | Flow unregistered between resolution and dispatch |

The endpoint is fire-and-forget. A 202 means the action started; it
does not mean it finished. Action errors after dispatch land on the
`RequestRecord` and surface in DevTool, not in the dispatch response
body. The `action` field on the request record is the handler block's
name, recorded for provenance — a scheduled handler is never reachable
through the action endpoint.

Example call:

```bash
curl -X POST https://app.example.com/api/flows/billing/schedules/monthly-invoices/dispatch \
  -H "Authorization: Bearer ${FSDEV_SCHEDULER_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"nominalFireTime":"2026-06-01T00:00:00Z"}'
```

For a dynamic schedule the URL carries the resolver-defined id. The
default resource-collection helper uses `<userId>/<key>`:

```bash
curl -X POST https://app.example.com/api/flows/reminders/schedules/u_abc/weekly-digest/dispatch \
  -H "Authorization: Bearer ${FSDEV_SCHEDULER_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"nominalFireTime":"2026-06-01T09:00:00Z"}'
```

## Authenticating dispatch

The dispatch endpoint goes through `host.resolvePrincipal` like every
other inbound route. The canonical pattern is a shared bearer secret
between the host scheduler and the dispatch endpoint.
`createBearerSecretPrincipalResolver`, exported from
`@flow-state-dev/engine`, does the constant-time comparison.

```ts
import { createBearerSecretPrincipalResolver } from "@flow-state-dev/engine";

defineFlow({
  kind: "billing",
  authentication: {
    resolvePrincipal: createBearerSecretPrincipalResolver({
      secret: process.env.FSDEV_SCHEDULER_SECRET!,
      principal: { userId: "system" }
    }),
    requireUser: true
  },
  schedules: {
    static: {
      "monthly-invoices": { cron: "0 0 1 * *", block: generateMonthlyInvoices }
    }
  }
});
```

Most flows that adopt scheduling already have a `resolvePrincipal`
that handles HTTP traffic (JWT verification, session lookup). Branch
on `ctx.source` instead of replacing the existing resolver:

```ts
authentication: {
  resolvePrincipal: async (ctx) => {
    if (ctx.source === "scheduled") {
      return verifyScheduleSecret(ctx);
    }
    return verifyJwtFromHeader(ctx);
  }
}
```

Replacing the existing resolver with a scheduler-only one breaks HTTP
routes. Branching on `ctx.source` keeps both paths working.

## Overlap policy

`onOverlap` controls what happens when a previous run of the same
schedule id is still in flight:

- `"skip"` (default) — return 200 with `{ status: "skipped", reason: "in_flight" }`,
  do not dispatch.
- `"allow"` — dispatch concurrently; new request runs alongside the
  existing one.

`onOverlap` is the scheduled-specific spelling of a [concurrency
policy](../advanced/concurrency-policies.md) keyed on the schedule id:
`"skip"` is `reject`, `"allow"` is `allow`.

Skip is best-effort. If two ticks arrive within a few milliseconds of
each other, both can pass the in-flight check before either calls
`host.dispatch`, and both proceed. The framework-side idempotency
cache (next section) catches the dupe when both ticks carry the same
`nominalFireTime`. If you need exactly-once semantics across a tight
window, lean on the host scheduler's own idempotency.

## Idempotency

A `(scheduleId, nominalFireTime)` pair that arrives twice within the
configurable window returns `200 { status: "duplicate" }` on the
second call. Default window is 60 seconds; override on the adapter:

```ts
createScheduledTransportAdapter({ idempotencyWindowMs: 5 * 60_000 });
```

The cache is per-process and in-memory. For multi-process deployments,
either rely on the host scheduler's idempotency (Cloud Scheduler and
EventBridge dedupe at-least-once delivery on their side) or front the
adapter with a shared cache. v1 does not ship a distributed dedupe
layer.

A custom `idempotencyKey` on the body wins over the default key.

## Listing schedules

```
GET /api/flows/:flowKind/schedules
```

Returns the static map and a `dynamic.provided` flag. The flag tells
operators whether a resolver is wired up without exposing the dynamic
data (which lives in host-owned storage and isn't the framework's to
enumerate).

```json
{
  "static": [
    {
      "id": "monthly-invoices",
      "cron": "0 0 1 * *",
      "timezone": "UTC",
      "action": "generateMonthlyInvoices",
      "description": "First of the month, 00:00 UTC",
      "enabled": true
    }
  ],
  "dynamic": { "provided": true }
}
```

The `action` field holds the handler block's name (provenance for the
listing, not a resolver key). The listing endpoint goes through
`host.resolvePrincipal` and respects the flow's `requireUser` setting.

## What v1 doesn't do

A few cuts kept the surface honest:

- **No fan-out.** One dispatch fires exactly one `runAction`. If your
  scheduler wants to send 1000 reminders at 9am, it issues 1000
  dispatch calls with 1000 schedule ids. One-tick-many-invocations is
  a separate design.
- **No framework-side scheduler loop.** The framework receives
  dispatches; it does not fire them. Wire up Cloud Scheduler,
  EventBridge, Vercel Cron, or a small `setInterval` yourself. The
  integration guides walk through each.
- **No durable missed-window handling.** If the host scheduler misses
  a tick, the framework does not catch up. Retries and backfill are
  the host scheduler's responsibility.
- **No cross-tenant enumeration of dynamic schedules.** The listing
  endpoint reports static schedules only and a `dynamic.provided`
  boolean. The host's own UI surfaces dynamic schedules; it already
  owns the storage.

For host-side wiring, see:

- [Scheduled actions on Vercel Cron](/guides/scheduled-vercel-cron)
- [Scheduled actions on Cloud Scheduler](/guides/scheduled-cloud-scheduler)
- [Scheduled actions on EventBridge Scheduler](/guides/scheduled-eventbridge)
- [Dynamic scheduled actions](/guides/scheduled-dynamic)
- [Schedule index](./schedule-index.md) — when polling tick fan-out needs an index.

## Deploying

- [Deploying to Vercel](/guides/deploying-to-vercel)
- [Deploying to Railway](/guides/deploying-to-railway)
