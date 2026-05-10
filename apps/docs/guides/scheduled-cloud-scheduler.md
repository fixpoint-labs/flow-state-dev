---
sidebar_position: 11
title: Scheduled actions on Cloud Scheduler
---

# Scheduled actions on Cloud Scheduler

Google Cloud Scheduler fires HTTP targets on a cron schedule with
configurable retries, OIDC tokens, and dead-letter handling. It maps
cleanly to the scheduled-actions transport: POST + bearer header +
JSON body.

This guide assumes the scheduled adapter is already mounted. If not,
start with [Scheduled actions](/docs/server/scheduled).

## Creating a job

The simplest setup uses a shared bearer secret. Cloud Scheduler sends
the value as a header on every fire.

```bash
gcloud scheduler jobs create http monthly-invoices \
  --schedule="0 0 1 * *" \
  --time-zone="UTC" \
  --uri="https://app.example.com/api/flows/billing/schedules/monthlyInvoices/dispatch" \
  --http-method=POST \
  --headers="Authorization=Bearer ${FSDEV_SCHEDULER_SECRET},Content-Type=application/json" \
  --message-body='{"nominalFireTime":"2026-06-01T00:00:00Z"}' \
  --max-retry-attempts=3 \
  --min-backoff=30s \
  --max-backoff=600s
```

`nominalFireTime` is fixed in this example. If you want it to track
the actual fire moment, leave the body empty (the framework defaults
to `now()`) or template the field via Cloud Scheduler's body
substitution.

The dispatch endpoint mirrors the schedule on the framework side:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { createBearerSecretPrincipalResolver } from "@flow-state-dev/server";

defineFlow({
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
      monthlyInvoices: { cron: "0 0 1 * *", action: "generateMonthlyInvoices" }
    }
  },
  actions: { /* ... */ }
});
```

## OIDC alternative

If your service runs on Google Cloud and you'd rather use OIDC than a
shared secret, swap the auth header for `--oidc-service-account-email`
on the job and verify the resulting JWT in `resolvePrincipal`:

```bash
gcloud scheduler jobs create http monthly-invoices \
  --schedule="0 0 1 * *" \
  --uri="https://app.example.com/api/flows/billing/schedules/monthlyInvoices/dispatch" \
  --http-method=POST \
  --oidc-service-account-email="scheduler@my-project.iam.gserviceaccount.com" \
  --oidc-token-audience="https://app.example.com"
```

`resolvePrincipal` then verifies the Google-issued OIDC token instead
of comparing a shared string. Cloud Scheduler signs the token per
fire, so rotation is automatic.

## Retries

Cloud Scheduler retries failed runs (non-2xx responses) according to
the `--max-retry-attempts` and backoff settings on the job. The
framework's `(scheduleId, nominalFireTime)` idempotency dedupes a
retry that lands within the configured window — the second response
is `200 { status: "duplicate" }` and the action does not run twice.

If the action itself fails after the dispatch returned 202, Cloud
Scheduler does not retry — the dispatch was successful from its
perspective. The action error lands on the `RequestRecord` and the
flow's `onErrored` lifecycle hook runs.

## Time zones

`--time-zone` on the job is the cron evaluation zone. The framework
treats `schedule.timezone` as opaque metadata; it surfaces in
`metadata.timezone` on the request but doesn't drive evaluation.
Set both to the same value for consistency in DevTool.

## Limitations

- The job's body is fixed at create time. If your action needs
  per-fire input that varies, compute it inside the action from the
  `nominalFireTime` and any state in the flow's user/org scope. Cloud
  Scheduler doesn't template body fields beyond a fixed string.
- Dead-letter and alerting are managed in Cloud Scheduler, not in the
  framework. Wire those up on the job if you need persistent failure
  signal beyond what `RequestRecord.status === "errored"` gives you.
