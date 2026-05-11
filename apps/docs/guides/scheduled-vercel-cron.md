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
endpoint is POST-only. The standard workaround is a small
GET-to-POST shim handler at the Vercel route, which forwards the
request to the framework endpoint.

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

You can have one shim per schedule, or one generic shim that maps
`(flowKind, scheduleId)` from a path segment. One-per-schedule is
simpler when there are only a few; a generic shim wins once the
list grows.

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

The tick handler reads your schedule index (a SQL table, a Redis
sorted set by `nextFireAt`, whatever) and POSTs to the framework
endpoint per due schedule:

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

The full pattern — index shape, when to write/update/delete index
rows, how to handle catch-up — is in
[Dynamic scheduled actions](/guides/scheduled-dynamic). The
takeaway for Vercel: one tick entry covers unbounded dynamic
schedules. The `vercel.json` cap only matters for *static* entries
you want Vercel itself to fire on a schedule.

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
