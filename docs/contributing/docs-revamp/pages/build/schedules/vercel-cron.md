---
title: Run on a schedule with Vercel Cron
type: recipe
description: "Vercel Cron fires HTTPS requests on a schedule from the Vercel control plane."
---

# Run on a schedule with Vercel Cron

Vercel Cron calls a URL on your deployment on a schedule. Point it at the
scheduled-actions dispatch endpoint and you have a scheduler, configured in
`vercel.json` and protected by a shared secret.

This guide assumes the scheduled-actions transport is already mounted. If
not, start with [Scheduled actions](/docs/server/scheduled).

## 1. Declare the schedule

A static schedule is an entry on the flow's `schedules.static` map. It names
a cron expression and the handler block to run. The flow never fires it
itself: Vercel Cron does.

The resolver for scheduled calls is built once, at the top of the file, so a
missing `CRON_SECRET` stops the app at startup instead of on the first cron
request. The principal is who the scheduled run belongs to.

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import {
  createBearerSecretPrincipalResolver,
  defaultBodyUserIdPrincipalResolver
} from "@flow-state-dev/engine";
import { sweepStaleTickets } from "./blocks/sweep-stale-tickets";

const resolveScheduled = createBearerSecretPrincipalResolver({
  secret: process.env.CRON_SECRET!,
  principal: { userId: "system", orgId: "org_support" }
});

export default defineFlow({
  kind: "support",
  authentication: {
    resolvePrincipal: async (ctx) =>
      ctx.source === "scheduled"
        ? resolveScheduled(ctx)
        : defaultBodyUserIdPrincipalResolver(ctx), // your existing auth
    requireUser: true
  },
  schedules: {
    static: {
      "stale-ticket-sweep": {
        cron: "0 8 * * *",
        block: sweepStaleTickets,
        description: "Close tickets with no reply for 14 days"
      }
    }
  }
});
```

`sweepStaleTickets` is a handler block in `blocks/sweep-stale-tickets.ts`
beside the flow. Branching on `ctx.source` keeps the bearer resolver away
from your HTTP routes. See
[Authentication and resolvers](../reference/auth.md) for the resolver's
signature and the `source` values.

## 2. Add the cron entry

Vercel Cron sends a GET and the dispatch endpoint accepts only POST, so the
cron entry points at a small route in your app that forwards the call. The
`schedule` here must match the `cron` on the flow entry. Nothing compares
the two.

```json title="vercel.json"
{
  "crons": [
    { "path": "/api/cron/support/stale-ticket-sweep", "schedule": "0 8 * * *" }
  ]
}
```

```ts title="src/app/api/cron/support/stale-ticket-sweep/route.ts"
import { createGetToPostCronShim } from "@flow-state-dev/vercel/schedules";

export const dynamic = "force-dynamic";
export const GET = createGetToPostCronShim({
  flowKind: "support",
  scheduleId: "stale-ticket-sweep"
});
```

Set `NEXT_PUBLIC_BASE_URL` to your deployment's origin. The route forwards to
the dispatch endpoint there. Options, defaults and the failure cases are in
the [schedules reference](../reference/schedules.md#cron-shim).

## 3. Protect the endpoint

Set `CRON_SECRET` in the project's environment variables. Vercel Cron sends
it on every cron request as `Authorization: Bearer ${CRON_SECRET}`. The shim
checks it, then forwards it, and the flow's resolver checks it again before
the dispatch endpoint reads anything. A request without it gets `401`.

That secret is the only protection. Anyone who holds it can fire any
schedule on a flow whose resolver accepts it. To rotate it, change
`CRON_SECRET` in the project's environment variables. The old value stops
working.

If you set `defaultUserId` on the flow, a request with no header runs as
that user instead of failing. Leave it unset on a flow that has scheduled
handlers.

## 4. Check a run

Fire the schedule once without waiting for Vercel. Send no body, so the call
counts against the most recent scheduled time that has passed:

```bash
curl -X POST "$NEXT_PUBLIC_BASE_URL/api/flows/support/schedules/stale-ticket-sweep/dispatch" \
  -H "Authorization: Bearer $CRON_SECRET"
```

`202` means the handler started. It does not mean it finished: an error in
the handler shows on the run's request record, not in this response. `200`
with `duplicate` means that scheduled time has already fired, so nothing
ran. `200` with `skipped` means the previous run has not finished. A `200`
from Vercel's own cron call only says the dispatch answered, so read it the
same way. Status codes and the rest of the contract are in the
[schedules reference](../reference/schedules.md#dispatch-endpoint).

Vercel Cron does not run under `vercel dev`. Use the curl above while you
develop.

## Many schedules at once

Vercel limits how many entries `vercel.json` may hold, and the limit
differs by plan. For schedules created at runtime, such as one per user, do
not add an entry each. Add one entry that ticks every few minutes and have
`createScheduleTickHandler` dispatch whatever is due. The
[schedule index](/docs/server/schedule-index) holds the due times, and
[the schedules reference](../reference/schedules.md#tick-handler) lists the
handler's options, cadence and delivery guarantee.

## Limits

- Vercel Cron fires once per slot. If the dispatch returns a non-2xx, the
  run is over and the framework does not retry it.
- A skipped tick is not backfilled. If you need delivery you can count on,
  use [Cloud Scheduler](/guides/scheduled-cloud-scheduler) or
  [EventBridge Scheduler](/guides/scheduled-eventbridge).
- Check Vercel's cron documentation for the plan limits on entry count and
  how often a schedule may run.
