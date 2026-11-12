# @flow-state-dev/scheduled

Run flow handlers on a schedule. The framework owns the dispatch endpoint; your host runs the scheduler.

```bash
pnpm add @flow-state-dev/scheduled
```

```ts
import { defineFlow } from "@flow-state-dev/core";
import { createBearerSecretPrincipalResolver, createFlowApiRouter } from "@flow-state-dev/engine";
import { createScheduledTransportAdapter } from "@flow-state-dev/scheduled";

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

const router = createFlowApiRouter({ registry, stores, adapters: [createScheduledTransportAdapter()] });
```

Reference: [the `scheduled` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/scheduled).
