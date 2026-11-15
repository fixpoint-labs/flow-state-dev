---
title: Run on a schedule with Cloud Scheduler
type: recipe
description: "Have Google Cloud Scheduler call a flow's schedule on a cron, with a shared secret, retries and no duplicate runs."
---

# Run on a schedule with Cloud Scheduler

Flow State does not run schedules itself. Your host's scheduler calls an
endpoint, and the flow runs its block. Google Cloud Scheduler is one such
scheduler: it POSTs a URL on a cron, with a header you choose and retries
when the call fails.

This recipe makes it run `monthly-invoices`, a schedule on the `billing`
flow, on the first of each month. It assumes the scheduled adapter is
mounted: `createScheduledTransportAdapter()` from
`@flow-state-dev/scheduled`, which adds the dispatch endpoint. If not,
start with [Scheduled actions](/docs/server/scheduled).

## 1. Declare the schedule on the flow

A schedule is an entry under `schedules.static`, keyed by the name that
will appear in the job's URL. It carries a `cron` and the block to run.
`generateMonthlyInvoices` is a block, a unit of work, that lives in its own
file beside the flow:

```ts title="src/flows/billing/blocks/generate-monthly-invoices.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const generateMonthlyInvoices = handler({
  name: "generate-monthly-invoices",
  inputSchema: z.object({}),
  outputSchema: z.object({ generated: z.number() }),
  execute: async () => {
    // Create the month's invoices here.
    return { generated: 0 };
  },
});
```

The flow registers it as the schedule's handler:

```ts title="src/flows/billing/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { createBearerSecretPrincipalResolver } from "@flow-state-dev/engine";
import { generateMonthlyInvoices } from "./blocks/generate-monthly-invoices";

export default defineFlow({
  kind: "billing",
  authentication: {
    resolvePrincipal: createBearerSecretPrincipalResolver({
      secret: process.env.FSDEV_SCHEDULER_SECRET!,
      principal: { userId: "system", orgId: "org_sys" }
    }),
    requireUser: true
  },
  schedules: {
    static: {
      "monthly-invoices": {
        cron: "0 0 1 * *",
        timezone: "UTC",
        block: generateMonthlyInvoices
      }
    }
  },
  actions: {}
});
```

The resolver compares the `Authorization: Bearer` header to your shared
secret and runs the schedule as the `system` user.

## 2. Create the job

Point the job at the schedule's dispatch URL, `/api/flows/<flow>/schedules/<name>/dispatch`,
and send the secret as a bearer header.

```bash
gcloud scheduler jobs create http monthly-invoices \
  --schedule="0 0 1 * *" \
  --time-zone="UTC" \
  --uri="https://app.example.com/api/flows/billing/schedules/monthly-invoices/dispatch" \
  --http-method=POST \
  --headers="Authorization=Bearer ${FSDEV_SCHEDULER_SECRET}" \
  --max-retry-attempts=3 \
  --min-backoff=30s \
  --max-backoff=600s
```

The job sends no body. Each fire runs the block for the most recent
scheduled time that is due.

Write the same cron in `--schedule` and in the flow, and the same zone in
`--time-zone` and `timezone`. Cloud Scheduler decides when it fires. The
flow reads its own `cron` and `timezone` to work out which scheduled time a
fire is for, so a mismatch can refuse a fire or count it against the wrong
time.

## 3. Check it

List the flow's schedules with the same header:

```bash
curl -H "Authorization: Bearer ${FSDEV_SCHEDULER_SECRET}" \
  https://app.example.com/api/flows/billing/schedules
```

`monthly-invoices` should be in the list. A fire the flow accepts answers
`202 { status: "accepted", scheduleId, origin: "static", requestId }`. That
means the block started, not that it finished. The `requestId` names the
request, the record Flow State keeps of this run. Read it with
`GET /api/flows/billing/requests/<requestId>/status`, using the same header.
Add `?include_result_output=true` to see the block's output or error.

## Retries

Cloud Scheduler retries a run that gets a non-2xx answer, following the
`--max-retry-attempts` and backoff flags on the job. A retry never runs the
block twice: each scheduled time fires at most once, and a repeat answers
`200 { status: "duplicate" }`. What a retry does once the next scheduled
time has come is in [Schedules](../reference/schedules.md).

If the block fails after the `202`, Cloud Scheduler does not retry. Look up
the request by its `requestId`, as in step 3: its `status` is `errored` and
the error is in its result. See [Errors](../reference/errors.md).

## Use OIDC instead of a shared secret

On Google Cloud you can have the job send a Google-signed OIDC token and
drop the shared secret:

```bash
gcloud scheduler jobs create http monthly-invoices \
  --schedule="0 0 1 * *" \
  --time-zone="UTC" \
  --uri="https://app.example.com/api/flows/billing/schedules/monthly-invoices/dispatch" \
  --http-method=POST \
  --oidc-service-account-email="scheduler@my-project.iam.gserviceaccount.com" \
  --oidc-token-audience="https://app.example.com"
```

Flow State does not verify Google's tokens for you. You write the check
yourself in the flow's `resolvePrincipal`: verify the token, then return a
principal with a `userId` and `orgId`, or throw a
`PrincipalResolutionError` with status 401 to refuse. Set the audience to
whatever value your resolver checks. See
[Authentication and tenancy](../reference/authentication.md).

## What it won't do

- Change the block's input per fire. The job's request is fixed, so the
  input comes from the schedule's `input`, a value or a function. See
  [Schedules](../reference/schedules.md).
- Alert you or park failed runs. Dead-letter handling and alerting are
  Cloud Scheduler settings on the job. The framework's own failure signal
  is a request with `status: "errored"`, read by `requestId` as in step 3.
