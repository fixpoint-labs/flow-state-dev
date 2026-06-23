# @flow-state-dev/scheduled

Scheduled-actions transport adapter for `@flow-state-dev/server`.

Mounts a single dispatch endpoint per flow:

```
POST /api/flows/:kind/schedules/:scheduleId/dispatch
GET  /api/flows/:kind/schedules
```

The framework owns the dispatch contract, validation, two-phase auth, and
provenance. The host runs the scheduler (Vercel Cron, Cloud Scheduler,
EventBridge, GitHub Actions, `node-cron`).

## Install

```bash
pnpm add @flow-state-dev/scheduled
```

## Mount the adapter

```ts
import { createFlowApiRouter } from "@flow-state-dev/server";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";

const router = createFlowApiRouter({
  registry,
  stores,
  adapters: [createScheduledTransportAdapter()]
});
```

## Static schedules

```ts
import { defineFlow } from "@flow-state-dev/core";
import { createBearerSecretPrincipalResolver } from "@flow-state-dev/server";

export const billing = defineFlow({
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
      "monthly-invoices": {
        cron: "0 0 1 * *",
        block: generateMonthlyInvoices
      }
    }
  }
});
```

A static schedule carries its handler `block` inline (the shared action core),
not a name pointing into `flow.actions`. Same model the webhook and chat
transports use. `defineScheduleBinding` (exported from `@flow-state-dev/core`)
is the optional typed constructor. A scheduled handler has no HTTP or MCP caller
surface; declare a block in both `schedules.static` and `flow.actions` (same
reference) to expose it both ways.

## Dynamic schedules (per-user reminders, agent-created follow-ups)

A persisted schedule row can't hold a block, so it stores a `kind`
discriminator string instead. The resolver maps `kind → block` through a
required `blocks` map.

```ts
import {
  createResourceCollectionScheduleResolver,
  type ScheduleResourceState
} from "@flow-state-dev/scheduled";
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

const userSchedules = defineResourceCollection<ScheduleResourceState>({
  pattern: "schedules/*",
  scope: "user",
  stateSchema: z.object({
    cron: z.string(),
    kind: z.string(),          // handler discriminator, not a flow-action name
    input: z.unknown().optional(),
    timezone: z.string().optional(),
    onOverlap: z.enum(["skip", "allow"]).optional(),
    description: z.string().optional(),
    enabled: z.boolean().default(true)
  })
});

defineFlow({
  kind: "reminders",
  user: { resources: { schedules: userSchedules } },
  schedules: {
    resolve: createResourceCollectionScheduleResolver({
      collection: userSchedules,
      blocks: { sendDigest, sendReminder }   // persisted `kind` → block
    })
  }
});
```

The default URL convention is `<userId>/<collectionKey>`. Override with
`parseId` for richer compositions. A row whose `kind` isn't in the `blocks`
map resolves to `null` (404).

**Durable dynamic schedules don't recover across crashes.** A dynamic
schedule's action core is produced by the resolver at dispatch time and carried
on the dispatch envelope, never persisted (a block can't be serialized). So a
durable dynamic schedule mid-run when the process crashes has no persisted
coordinate to re-resolve its handler from, and the run is dropped. Static
schedules recover normally — their handler is reachable from a stable
coordinate. Make a durable scheduled action static if it must survive a crash.

## Source and metadata

Every scheduled-driven request carries `source: "scheduled"` and a namespaced
`metadata.schedule`:

- `metadata.schedule.scheduleId` — the dispatch URL id
- `metadata.schedule.origin` — `"static"` or `"dynamic"`
- `metadata.schedule.cron`, `metadata.schedule.nominalFireTime`,
  `metadata.schedule.dispatchedAt`, `metadata.schedule.timezone`

The dispatched request's `action` field is the handler block's name (provenance
only — a scheduled handler is never reachable through the action endpoint).

## Schedule index

`ScheduleIndex` is an opt-in adapter interface that lets a polling cron tick find due dynamic schedules in one query, instead of scanning every user's schedule collection. Store packages implement it (`createPostgresScheduleIndex`, `createSQLiteScheduleIndex`); custom backends implement the three-method interface directly.

The contract is at-most-once: `claimDue` atomically advances rows before returning them, so a dispatch that fails after advance is dropped, not retried.

### `defineScheduleCollection`

`defineScheduleCollection({ pattern, index })` wraps `defineResourceCollection` with the schedule state schema and mirrors every create/update/delete into the supplied index using lifecycle hooks. Omit `index` and the collection still works — no mirroring, no hooks.

```ts
import { defineScheduleCollection } from "@flow-state-dev/scheduled";
import { createSQLiteScheduleIndex } from "@flow-state-dev/store-sqlite";

const index = createSQLiteScheduleIndex(db);

export const schedules = defineScheduleCollection({
  pattern: "schedules/*",
  index
});
```

Rows with `enabled: false` are removed from the index, so toggling a schedule off stops it firing without deleting the underlying record.

### Conformance suite

`@flow-state-dev/scheduled/testing` exports `createScheduleIndexConformanceTests` for new `ScheduleIndex` implementations:

```ts
import { describe } from "vitest";
import { createScheduleIndexConformanceTests } from "@flow-state-dev/scheduled/testing";

createScheduleIndexConformanceTests("my-backend", {
  createIndex: () => /* fresh empty index */,
  cleanup: (idx) => /* tear down */
});
```

Covers upsert idempotence, atomic claim+advance, no-op remove, bad-cron skip, and the `limit` parameter. The Postgres and SQLite adapters both run this suite against their backends.

See [the schedule index reference](https://flow-state.dev/docs/server/schedule-index) for the full interface and contract.

## See also

- [Scheduled actions reference](https://flow-state.dev/docs/server/scheduled) — full reference guide
- [Schedule index reference](https://flow-state.dev/docs/server/schedule-index) — schedule index reference
- [Vercel Cron guide](https://flow-state.dev/guides/scheduled-vercel-cron)
- [Cloud Scheduler guide](https://flow-state.dev/guides/scheduled-cloud-scheduler)
- [EventBridge guide](https://flow-state.dev/guides/scheduled-eventbridge)
- [Dynamic schedules guide](https://flow-state.dev/guides/scheduled-dynamic)
