---
title: Run on a schedule with Vercel Cron
type: recipe
description: "Run a flow's schedule on Vercel with one cron entry, one route and a shared secret."
---

# Run on a schedule with Vercel Cron

A Vercel deployment has no process that stays up to keep time. Vercel Cron fills that gap: it calls one URL on your app every few minutes. That call runs the app's schedule tick, which fires every schedule that has come due by posting to that schedule's dispatch endpoint, `/api/flows/<flow>/schedules/<name>/dispatch`. You set up one `vercel.json` entry, one route and one shared secret.

This guide assumes the app serves its flows under `/api/flows`, where the schedule routes live, as in [Deploy to Vercel](../deploy/vercel.md). Options and exact answers are in the [schedules reference](../../reference/schedules.md).

## 1. Declare the schedule

A static schedule is an entry on the flow's `schedules.static` map. It names a cron expression and the handler block to run.

```ts title="src/flows/support/blocks/sweep-stale-tickets.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const sweepStaleTickets = handler({
  name: "sweep-stale-tickets",
  inputSchema: z.object({}).passthrough(),
  execute: async (_input, ctx) => {
    console.log(`sweeping as ${ctx.user?.identity.userId}`);
  }
});
```

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { createBearerSecretPrincipalResolver } from "@flow-state-dev/engine";
import { resolveUser } from "../../lib/session";
import { sweepStaleTickets } from "./blocks/sweep-stale-tickets";

const resolveScheduled = createBearerSecretPrincipalResolver({
  secret: process.env.CRON_SECRET!,
  principal: { userId: "system", orgId: "org_support" }
});

const supportFlow = defineFlow({
  kind: "support",
  actions: {},
  authentication: {
    resolvePrincipal: async (ctx) =>
      ctx.source === "scheduled"
        ? resolveScheduled(ctx)
        : resolveUser(ctx),
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

export default supportFlow();
```

The principal is who the scheduled run belongs to: inside `sweepStaleTickets`, `ctx.user.identity.userId` is `system`. The principal must name an organization, here `org_support`, or the call is refused. The resolver branches on `ctx.source`, so the secret is accepted on scheduled calls and nowhere else. `resolveUser` is your own auth, returning a verified `userId` and `orgId` ([Auth and tenancy](../../concepts/auth-and-tenancy.md)). A scheduled handler is not listed in `actions`, so the dispatch endpoint is the only way to run it. [Authentication and resolvers](../../reference/authentication.md) has the resolver's signature and the `source` values.

## 2. Add the cron route

The app is told how its schedules fire with `createFlowState({ scheduler })`. Pass `vercelScheduler()` only on Vercel, so `fsdev dev` and `next dev` keep their own local cron.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { vercelScheduler } from "@flow-state-dev/vercel";
import support from "./src/flows/support/flow";

export const scheduler = vercelScheduler();

export default createFlowState({
  flows: [support],
  scheduler: process.env.VERCEL ? scheduler : undefined
  // ...your stores and other options
});
```

The scheduler's `route` is the handler Vercel Cron calls. Export it as the `GET` of one route, and point one cron entry at it.

```ts title="src/app/api/cron/schedules/route.ts"
import { scheduler } from "../../../../../fsdev.config";

export const GET = scheduler.route;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

```json title="vercel.json"
{
  "crons": [
    { "path": "/api/cron/schedules", "schedule": "*/15 * * * *" }
  ]
}
```

That entry serves every schedule. Its `schedule` is how often the tick runs, not when your flow fires: each due time comes from the flow's own `cron`. A schedule fires on the first beat after its time, so `0 8 * * *` behind a 15-minute beat runs between 08:00 and 08:15.

## 3. Protect the route

Set `CRON_SECRET` in the project's environment variables. Vercel Cron sends it on every cron request as `Authorization: Bearer ${CRON_SECRET}`, and the tick sends the same header on each dispatch it makes.

That secret is the only protection. No network rule restricts the cron route or the dispatch endpoints. A wrong or missing secret gets `401` from both. If `CRON_SECRET` is unset, nothing is left open: the cron route refuses every call, and the app fails as it loads, because `createBearerSecretPrincipalResolver` throws on an empty secret. Anyone who holds the secret can fire any schedule on a flow whose resolver accepts it. To rotate it, change `CRON_SECRET` and redeploy.

## 4. Check a run

Call the cron route the way Vercel does:

```bash
curl "$APP_URL/api/cron/schedules" -H "Authorization: Bearer $CRON_SECRET"
```

It answers `200` with `{ "dispatched": <n> }`, where `n` is the number of schedules that were due, so `0` is normal between beats. It is a real tick, but each scheduled time fires at most once. `dispatched` counts the fires the tick sent, not the ones that succeeded.

To fire one schedule without waiting, post to its dispatch endpoint. With no body, the call stands in for the most recent scheduled time, so a second call for the same time returns `duplicate`.

```bash
curl -X POST "$APP_URL/api/flows/support/schedules/stale-ticket-sweep/dispatch" \
  -H "Authorization: Bearer $CRON_SECRET"
```

The dispatch answers:

- `202`: the handler has started. An error in it does not appear in the response.
- `200` with `duplicate`: that time has already fired.
- `200` with `skipped`: the previous run has not finished.

Find a handler's error in the DevTool, as described in [Debug a run](../debug-a-run.md). Vercel's cron log shows only the cron route's own answer, so a green entry says the tick ran, not that a handler succeeded. `GET /api/flows/support/schedules` with the same header lists the flow's schedules, which confirms the entry registered.

Where `VERCEL` is unset, as under `fsdev dev` and `next dev`, the app's own cron fires schedules each minute. The dispatch call works against it; the cron route answers `500` there, because `vercelScheduler()` is not passed in.

## Many schedules at once

Vercel limits how many entries `vercel.json` may hold, and the limit differs by plan, as does how often an entry may run. Check Vercel's cron documentation. You do not need an entry per schedule. The one entry above also fires schedules created at run time, such as one per user. [Let users schedule work at run time](./at-run-time.md) shows how.

## Limits

- The tick runs once per cron beat, and each due schedule fires once per tick. After downtime or a missed beat, a schedule fires once, late, for the latest time it missed. Earlier missed times are not run.
- If a dispatch returns a non-2xx, the run is over and the framework does not retry it.
- A run that continues after the `202` needs the function kept alive, which [Deploy to Vercel](../deploy/vercel.md) sets up.
- On a memory or filesystem store, the once-per-time guarantee holds per process only. Use SQLite or Postgres.
