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

## See also

- `apps/docs/docs/server/scheduled.md` — full reference guide
- `apps/docs/guides/scheduled-vercel-cron.md`
- `apps/docs/guides/scheduled-cloud-scheduler.md`
- `apps/docs/guides/scheduled-eventbridge.md`
- `apps/docs/guides/scheduled-dynamic.md`
