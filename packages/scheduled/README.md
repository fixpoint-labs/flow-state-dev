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
        action: "generateMonthlyInvoices"
      }
    }
  },
  actions: { /* ... */ }
});
```

## Dynamic schedules (per-user reminders, agent-created follow-ups)

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
    action: z.string(),
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
    resolve: createResourceCollectionScheduleResolver({ collection: userSchedules })
  },
  actions: { /* ... */ }
});
```

The default URL convention is `<userId>/<collectionKey>`. Override with
`parseId` / `formatId` for richer compositions.

## Source and metadata

Every scheduled-driven request carries:

- `source: "scheduled"`
- `metadata.scheduleId` — the dispatch URL id
- `metadata.origin` — `"static"` or `"dynamic"`
- `metadata.cron`, `metadata.nominalFireTime`, `metadata.dispatchedAt`,
  `metadata.timezone`

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
