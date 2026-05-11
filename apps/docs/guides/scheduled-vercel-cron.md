---
sidebar_position: 10
title: Scheduled actions on Vercel Cron
---

# Scheduled actions on Vercel Cron

Vercel Cron fires HTTPS requests on a schedule from the Vercel
control plane. Combined with the scheduled-actions transport, that's
your scheduler — declared in `vercel.json`, authenticated with a
shared secret, dispatched at the configured cadence.

This guide assumes you already have the scheduled adapter mounted.
If not, start with [Scheduled actions](/docs/server/scheduled).

## Setup

Vercel Cron sends GET requests by default, while the dispatch
endpoint is POST-only. `@flow-state-dev/vercel/schedules` ships a
helper that bridges the two:

`vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/billing/monthly-invoices",
      "schedule": "0 0 1 * *"
    }
  ]
}
```

The shim handler in your Next.js app:

```ts title="app/api/cron/billing/monthly-invoices/route.ts"
import { createGetToPostCronShim } from "@flow-state-dev/vercel/schedules";

export const dynamic = "force-dynamic";
export const GET = createGetToPostCronShim({
  flowKind: "billing",
  scheduleId: "monthly-invoices"
});
```

The shim reads `CRON_SECRET` and `NEXT_PUBLIC_BASE_URL` from env (both
overridable as options), validates the inbound bearer in constant
time, and forwards as a POST to
`…/api/flows/billing/schedules/monthly-invoices/dispatch` with the
same bearer.

### Advanced: write the shim by hand

If you need custom behaviour — alternate auth, custom logging, a
generic route that maps `(flowKind, scheduleId)` from a path segment —
write the handler yourself:

```ts title="app/api/cron/billing/monthly-invoices/route.ts"
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = headers().get("authorization") ?? "";
  // Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` if the env is set.
  // Reuse the same secret for the framework dispatch.
  const url = new URL(
    "/api/flows/billing/schedules/monthly-invoices/dispatch",
    process.env.NEXT_PUBLIC_BASE_URL!
  );
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: auth,
      "content-type": "application/json"
    },
    body: JSON.stringify({ nominalFireTime: new Date().toISOString() })
  });
  return new Response(await res.text(), { status: res.status });
}
```

## Bearer-secret auth

Set `CRON_SECRET` in Vercel's environment variables. Vercel Cron
sends it on every cron request as `Authorization: Bearer ${CRON_SECRET}`.
The framework verifies it on the dispatch endpoint via
`createBearerSecretPrincipalResolver`:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { createBearerSecretPrincipalResolver } from "@flow-state-dev/server";

defineFlow({
  kind: "billing",
  authentication: {
    resolvePrincipal: async (ctx) => {
      if (ctx.source === "scheduled") {
        return createBearerSecretPrincipalResolver({
          secret: process.env.CRON_SECRET!,
          principal: { userId: "system" }
        })(ctx);
      }
      // your existing HTTP auth path
      return verifyJwtFromHeader(ctx);
    },
    requireUser: true
  },
  schedules: {
    static: {
      "monthly-invoices": { cron: "0 0 1 * *", action: "generateMonthlyInvoices" }
    }
  },
  actions: { /* ... */ }
});
```

The shared secret is the only auth on this surface. If it leaks,
rotate `CRON_SECRET` in Vercel and on the host. Existing in-flight
dispatches finish; new dispatches on the old value get 401.

## Dynamic schedules at scale

Vercel caps `vercel.json` cron entries (Pro: 40 per project at time
of writing; lower on Hobby). That cap applies to the schedules
declared in your config file, not to the number of *dispatches* you
can issue from a single cron entry.

For dynamic schedules — per-user reminders, agent-created
follow-ups, anything created at runtime — do **not** add one
`vercel.json` entry per schedule. Add one tick entry, and have its
handler fan out per-schedule POSTs to the dispatch endpoint.

```json title="vercel.json"
{
  "crons": [
    { "path": "/api/cron/schedule-tick", "schedule": "*/1 * * * *" }
  ]
}
```

The tick handler claims due rows from a `ScheduleIndex` and POSTs to
the framework endpoint per due schedule.
`@flow-state-dev/vercel/schedules` ships `createScheduleTickHandler`
to do that with bounded concurrency:

```ts title="app/api/cron/schedule-tick/route.ts"
import { createScheduleTickHandler } from "@flow-state-dev/vercel/schedules";
import { scheduleIndex } from "@/lib/schedule-index"; // your ScheduleIndex

export const dynamic = "force-dynamic";
export const GET = createScheduleTickHandler({
  flowKind: "reminders",
  index: scheduleIndex
});
```

The index is the read-model the cron beat scans. Define it once at
boot — `createPostgresScheduleIndex(executor)` or
`createSQLiteScheduleIndex(db)` from your store adapter — and feed it
on the write side via
[`defineScheduleCollection`](/docs/server/schedule-index#auto-mirroring-with-definedchedulecollection).

`claimDue` advances rows atomically before returning them. The
contract is at-most-once: a dispatch that fails after the row has been
advanced is dropped. Pass `onDispatch` to observe each attempt.

The tick cadence (`*/1 * * * *` above is once a minute) is the
floor on how soon a newly-due schedule can fire. Coarser ticks
trade lag for invocation cost. Vercel meters cron invocations on
Pro, so a per-minute tick is ~43k invocations/month — usually fine
but worth knowing.

The full pattern is in
[Dynamic scheduled actions](/guides/scheduled-dynamic) and the
[Schedule index reference](/docs/server/schedule-index). The
takeaway for Vercel: one tick entry covers unbounded dynamic
schedules. The `vercel.json` cap only matters for *static* entries
you want Vercel itself to fire on a schedule.

### Advanced: write the tick handler by hand

When you need custom behaviour the helper doesn't cover (a non-index
storage shape, custom retry logic, observability hooks beyond
`onDispatch`):

```ts title="app/api/cron/schedule-tick/route.ts"
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const now = Date.now();
  const due = await dueSchedules(now); // your index query
  await Promise.allSettled(
    due.map(async (row) => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL}/api/flows/reminders/schedules/${row.userId}/${row.key}/dispatch`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${process.env.CRON_SECRET}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({ nominalFireTime: new Date(now).toISOString() })
        }
      );
      if (res.ok) await advanceIndex(row, now);
    })
  );
  return new Response("ok");
}
```

The tick cadence (`*/1 * * * *` above is once a minute) is the
floor on how soon a newly-due schedule can fire. Coarser ticks
trade lag for invocation cost. Vercel meters cron invocations on
Pro, so a per-minute tick is ~43k invocations/month — usually fine
but worth knowing.

## Local development

Vercel Cron does not run in `vercel dev`. Two options for testing
locally:

1. `node-cron` running inside a small dev-only worker that POSTs to
   the dispatch endpoint with the same bearer secret. Closest to
   production behaviour.
2. A `curl` loop or a one-shot manual POST. Faster for iterating on
   the action itself.

```bash
curl -X POST http://localhost:3000/api/flows/billing/schedules/monthly-invoices/dispatch \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"nominalFireTime":"2026-06-01T00:00:00Z"}'
```

## Limitations

- **No retries.** Vercel Cron fires once per schedule slot. If the
  dispatch returns a non-2xx, the cron run is over. The framework
  does not retry on its own.
- **No missed-window backfill.** A skipped tick stays skipped.
  Production workloads that need at-least-once delivery should use
  Cloud Scheduler or EventBridge instead, both of which retry on
  failure and dedupe at-least-once delivery.
- **Hobby plan caps.** Vercel's Hobby plan limits cron jobs by
  count and granularity. Check the plan docs before relying on
  sub-hour schedules.

For higher-reliability workloads, see
[Cloud Scheduler](/guides/scheduled-cloud-scheduler) or
[EventBridge Scheduler](/guides/scheduled-eventbridge).
