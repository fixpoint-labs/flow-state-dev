# @flow-state-dev/scheduled

Keep schedules a flow adds at run time: schedule collections, the resolver over them, and the schedule-index contract a store implements. Static schedules need nothing from here; the engine mounts the dispatch endpoint on every app.

```bash
pnpm add @flow-state-dev/scheduled
```

```ts
import { defineFlow } from "@flow-state-dev/core";
import { createBearerSecretPrincipalResolver, createFlowApiRouter } from "@flow-state-dev/engine";

export const billing = defineFlow({
  kind: "billing",
  authentication: {
    resolvePrincipal: createBearerSecretPrincipalResolver({
      secret: process.env.FSDEV_SCHEDULER_SECRET!,
      principal: { userId: "system" },
    }),
    requireUser: true,
  },
  schedules: { static: { "monthly-invoices": { cron: "0 0 1 * *", block: generateMonthlyInvoices } } },
});

// The schedule routes are the router's own: no adapter to pass.
const router = createFlowApiRouter({ registry, stores });
```

Reference: [the `scheduled` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/scheduled).
