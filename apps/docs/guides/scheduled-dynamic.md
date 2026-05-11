---
sidebar_position: 13
title: Dynamic scheduled actions
---

# Dynamic scheduled actions

A static schedule is a row baked into flow source. A dynamic schedule
is a row a user or an agent created at runtime: a weekly digest a
user subscribed to, a follow-up email an agent decided to send next
Monday, an alert wired to a per-record threshold. The definition
isn't known when the flow is registered.

The framework owns the dispatch contract. The host owns the storage
and the scheduler. The bridge between them is the `schedules.resolve`
hook on the flow definition: given a schedule id, return a
`ScheduleConfig`, or `null` to 404 the dispatch.

This guide covers the full loop: store the definitions, fire them on
a cadence, dispatch through the framework, and run as the right user.

## The shape

The hook signature is straightforward:

```ts
schedules: {
  resolve(scheduleId, ctx): Promise<ScheduleConfig | null> | ScheduleConfig | null
}
```

The dispatch URL carries the id:

```
POST /api/flows/:flowKind/schedules/:scheduleId/dispatch
```

The id format is up to you, within URL-safe characters and a 128-char
limit. The reference helper uses `<userId>/<key>` because that maps
cleanly to a user-scoped resource lookup; custom resolvers pick
whatever scheme fits the underlying store.

Whatever the resolver returns is validated at dispatch time —
malformed cron, unknown action, or invalid principal returns 400
`invalid_schedule`. A return value of `null` is 404. A throw is 500
`resolver_failed`. Distinguish these in the resolver based on what
the host should do next.

## The reference helper

For schedules stored in a flow-state resource collection, the package
ships `createResourceCollectionScheduleResolver`. It parses the URL
id, reads the resource, synthesizes a `principal: { userId }` from
the resource's owning scope, and rejects URL-driven impersonation
(see [URL-driven impersonation guard](#url-driven-impersonation-guard)
below).

When it fits:

- Schedule definitions live alongside other user-scoped state.
- Users (or agents on behalf of users) create them via the standard
  resource API.
- The id format `<userId>/<key>` is acceptable in URLs.

When to write your own:

- Definitions live in a SQL table, an external service, or a
  cross-tenant store.
- The id format encodes more than `(userId, key)`.
- Lookup needs joins or auth checks beyond what the helper does.

The helper is a starting point. The shape of the resolver hook is
small enough that custom implementations are short.

## Wiring user-created schedules

The flow declares a user-scoped collection for schedule definitions
and an action that writes to it. The resolver hook reads the same
collection at dispatch time.

```ts
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import {
  createScheduledTransportAdapter,
  createResourceCollectionScheduleResolver,
  type ScheduleResourceState
} from "@flow-state-dev/scheduled";
import { z } from "zod";

const userSchedules = defineResourceCollection<ScheduleResourceState>({
  pattern: "schedules/*",
  scope: "user",
  stateSchema: z.object({
    cron: z.string(),
    action: z.string(),
    input: z.unknown().optional(),
    enabled: z.boolean().default(true)
  })
});

export const reminders = defineFlow({
  kind: "reminders",
  user: { resources: { schedules: userSchedules } },
  schedules: {
    resolve: createResourceCollectionScheduleResolver({ collection: userSchedules })
  },
  actions: {
    subscribeWeekly: {
      inputSchema: z.object({ topic: z.string() }),
      block: handler({
        name: "subscribe-weekly",
        execute: async ({ topic }, ctx) => {
          await ctx.user.resources.schedules.create("weekly-digest", {
            cron: "0 9 * * MON",
            action: "sendDigest",
            input: { topic },
            enabled: true
          });
          return { ok: true };
        }
      })
    },
    sendDigest: { /* ... */ }
  }
});
```

When the user calls `subscribeWeekly`, a row lands in their
user-scope `schedules/weekly-digest` resource. The host scheduler
(see below) discovers it on its next pass and POSTs to:

```
/api/flows/reminders/schedules/<userId>/weekly-digest/dispatch
```

The resolver parses the id, reads the resource, and returns the
config with `principal: { userId }`. The action runs as the user.

## Wiring agent-created schedules

Same shape — an agent block writes to the same collection instead of
a user-facing action:

```ts
import { handler } from "@flow-state-dev/core";

const scheduleFollowup = handler({
  name: "schedule-followup",
  execute: async ({ leadId, when }, ctx) => {
    await ctx.user.resources.schedules.create(`followup-${leadId}`, {
      cron: cronExpressionFor(when),
      action: "sendFollowupEmail",
      input: { leadId },
      enabled: true
    });
    return { scheduledFor: when };
  }
});
```

The user scope on the agent's execution context is the user the agent
is acting on behalf of. The schedule is owned by that user and the
dispatch runs as them. Cancelling a follow-up is a `delete()` on the
same collection.

## Discovering due schedules

The framework dispatches; it doesn't fire. Something on the host side
has to decide *when* to fire and POST to the dispatch endpoint. Two
recipes cover most setups.

### Polling loop

A small in-process worker scans an index on an interval, evaluates
each schedule's cron against the last fire time, and POSTs to the
dispatch endpoint when due. The framework only does per-user reads,
so the host maintains a separate index over `(userId, key, cron,
nextFireAt)` — written when the schedule is created, updated after
each fire, removed on delete. The index is what the loop reads;
the schedule resource is what the dispatch resolver reads.

```ts
import { CronExpressionParser } from "cron-parser";

// The index: one row per active schedule. Backed by Postgres, SQLite,
// Redis, or even a flow-state org-scope resource — anything that
// supports a "where nextFireAt <= now" query.
type ScheduleIndexRow = {
  userId: string;
  key: string;
  cron: string;
  nextFireAt: number; // ms since epoch
};

// Maintain the index alongside the schedule resource. Write on
// create, update after each fire, delete when the user cancels.
async function indexSchedule(row: ScheduleIndexRow) { /* INSERT/UPSERT */ }
async function dueSchedules(now: number): Promise<ScheduleIndexRow[]> { /* SELECT ... WHERE nextFireAt <= $1 */ }
async function advanceIndex(row: ScheduleIndexRow, now: number) {
  const next = CronExpressionParser.parse(row.cron, { currentDate: new Date(now) })
    .next()
    .getTime();
  await /* UPDATE ... SET nextFireAt = $1 WHERE userId = $2 AND key = $3 */ next;
}

const TICK_INTERVAL_MS = 30_000;

setInterval(async () => {
  const now = Date.now();
  const due = await dueSchedules(now);

  // Optional: bound concurrency to protect your own runtime.
  await Promise.allSettled(
    due.map(async (row) => {
      const res = await fetch(
        `${BASE_URL}/api/flows/reminders/schedules/${row.userId}/${row.key}/dispatch`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${process.env.FSDEV_SCHEDULER_SECRET}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({ nominalFireTime: new Date(now).toISOString() })
        }
      );
      if (res.ok) {
        await advanceIndex(row, now);
      }
      // Non-2xx: leave nextFireAt unchanged. The next tick retries.
    })
  );
}, TICK_INTERVAL_MS);
```

The index is the load-bearing piece. Without it, every tick has to
scan every user's schedules collection — which the resource API
doesn't even support in one query, and which doesn't scale anyway.
With it, the tick reads `O(due)` rows regardless of total user count.

Practical notes:

- **Idempotency.** `advanceIndex` only runs on a 2xx, so a failed
  dispatch (network error, framework 5xx) re-fires next tick. The
  framework's 60-second idempotency window dedupes `(scheduleId,
  nominalFireTime)` within that window if the retry lands too fast.
- **Catch-up.** If the tick has been down for an hour and four
  daily-at-9am schedules are now overdue, the loop will fire them
  all at once on next startup. If that's not desired, advance
  `nextFireAt` past `now` to the next future slot instead of firing.
- **Multi-process.** Run the tick on a single worker (leader
  election, a dedicated cron node, or a lock per row in the SQL
  case). Multiple replicas all firing the same rows produces
  duplicates the 60-second framework window catches but only
  within that window.
- **Granularity.** A 30-second tick handles minute-granular cron
  comfortably. Coarser ticks (5 min, 30 min) cost less in compute
  but introduce lag — a `0 9 * * *` schedule polled at :30 fires
  at 09:30, not 09:00. Match the tick to the tightest cron you
  intend to support.

### External scheduler API

When a user or agent creates a schedule, the same code path also
registers a managed job with Cloud Scheduler or EventBridge that
POSTs the dispatch URL at the configured cadence. Production-grade,
no in-process polling, retries and DLQs handled by the cloud
provider.

```ts
import { CloudSchedulerClient } from "@google-cloud/scheduler";

async function registerCloudJob(userId, key, cron, baseUrl) {
  const client = new CloudSchedulerClient();
  await client.createJob({
    parent: `projects/${PROJECT}/locations/${REGION}`,
    job: {
      name: `projects/${PROJECT}/locations/${REGION}/jobs/${userId}-${key}`,
      schedule: cron,
      timeZone: "UTC",
      httpTarget: {
        uri: `${baseUrl}/api/flows/reminders/schedules/${userId}/${key}/dispatch`,
        httpMethod: "POST",
        headers: { Authorization: `Bearer ${process.env.FSDEV_SCHEDULER_SECRET}` },
        body: Buffer.from(JSON.stringify({})).toString("base64")
      }
    }
  });
}
```

The trade-off is operational complexity: every schedule create and
delete now mutates two stores, and the resource record is no longer
the single source of truth. Cancellation needs to delete the cloud
job too, or it keeps firing past the user's intent.

## URL-driven impersonation guard

The default helper parses `<userId>/<key>` from the URL and reads the
resource at user scope `parsed.userId`. The user-scoped storage key is
the guard: a request like `/schedules/u_evil/k/dispatch` reads
`("user", "u_evil", "schedules/k")` — there's no resource at that key
unless `u_evil` owns one. A URL aimed at another user's data simply
doesn't find anything and the helper returns `null` (404).

This matters because the URL is attacker-controllable from anyone
holding the bearer secret. The shared secret proves the caller is the
trusted scheduler, not that the caller is the user named in the URL.
Custom resolvers using a global key (e.g. a SQL row keyed only by
schedule id, not by user) need to implement an explicit ownership
check themselves. The framework can't do it for arbitrary resolvers
because it doesn't know how the id maps to ownership.

## Dispatch principal

The action runs as `schedule.principal`. The reference helper
synthesizes `{ userId }` from the resource's owning scope, so a
schedule created under user `u_abc` runs as `u_abc`. The
`RequestRecord.userId` reflects this, and any user-scope state the
action reads or writes resolves correctly.

If the resolver returns a different principal — for example a
schedule created by an agent that should run as a system user with
elevated permissions — the action runs as that principal instead.
The resolver is the source of truth.

## When to use a custom resolver

The reference helper covers the common case. Reach for a custom
resolver when:

- Schedules live in a SQL table, not a resource collection. Read the
  row, build the `ScheduleConfig`, return it.
- The id encodes more than `(userId, key)`. Tenant id, project id,
  schedule version — your parser, your decision.
- Lookup involves an external service (a billing system that owns
  the schedule definitions, an auth service that owns the principal).

```ts
schedules: {
  resolve: async (scheduleId, ctx) => {
    const row = await db.scheduledJobs.findUnique({ where: { id: scheduleId } });
    if (!row || !row.enabled) return null;
    const owner = await auth.lookupUser(row.ownerId);
    if (!owner) return null;
    return {
      cron: row.cron,
      action: row.action,
      input: row.inputJson,
      principal: { userId: owner.id, orgId: owner.orgId }
    };
  }
}
```

The resolver can be async, can throw (returns 500), and runs after
gateway auth. `ctx.gatewayPrincipal` is the authenticated dispatch
caller — useful when the resolver needs to authorize the lookup.

## Limitations

- **No fan-out.** One dispatch fires one action. A "send the digest
  to everyone subscribed" pattern needs the host to issue one
  dispatch per recipient. The framework does not split a single tick
  into N invocations.
- **Minute granularity is the practical floor for polling.**
  `setInterval` based loops can technically run faster, but cron
  evaluation only resolves to the minute, so any sub-minute schedule
  fires every minute at most. Sub-minute work belongs on a different
  primitive.
- **Polling needs a user index.** The resource API is per-user reads,
  not cross-user enumeration. A polling loop has to track which users
  have active schedules separately from the resource collection
  itself.
