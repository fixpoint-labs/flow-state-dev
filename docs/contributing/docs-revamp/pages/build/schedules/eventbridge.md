---
title: Run on a schedule with EventBridge
type: recipe
description: "Have EventBridge Scheduler call a flow's schedule on a cron, with a shared secret, retries and a dead-letter queue."
---

# Run on a schedule with EventBridge

Flow State does not run schedules itself. Your host's scheduler calls an
endpoint, and the flow runs its block. EventBridge Scheduler is one such
scheduler: it calls an HTTPS URL on a cron, with retries and a
dead-letter queue for calls that keep failing.

This recipe makes it call `monthly-invoices`, a schedule on the `billing`
flow, on the first of each month. It assumes the scheduled adapter is
mounted and the flow declares the schedule, with `cron: "0 0 1 * *"` and a
`resolvePrincipal` that checks a bearer secret, as in
[Cloud Scheduler](./cloud-scheduler.md). If the adapter is not mounted,
start with [Serving flows](../../concepts/serving-flows.md).

## 1. Convert the cron expression

The flow's `cron` has five fields. EventBridge's has six, a trailing year,
and uses `?` for an unused day field. Write the same schedule in both
places. Don't paste the EventBridge form into the flow: the flow's `cron`
takes exactly five fields, and a six-field expression is refused when the
flow registers, so the app fails at boot. Convert the expression when you
create the job:

| Flow `cron` | EventBridge `cron(...)` |
| --- | --- |
| `0 0 1 * *` (1st of month, 00:00) | `cron(0 0 1 * ? *)` |
| `0 9 * * MON` (Monday 9am) | `cron(0 9 ? * MON *)` |
| `*/15 * * * *` (every 15min) | `cron(0/15 * * * ? *)` |

EventBridge decides when the call is made. The flow reads its own `cron` to
work out which scheduled time a call is for, so the two must name the same
instants. If they differ, the endpoint answers `400 not_a_scheduled_time`
on every fire, and the failed calls retry and end up in the dead-letter
queue. See [Schedules](../../reference/schedules.md).

## 2. Create the schedule

```bash
aws scheduler create-schedule \
  --name monthly-invoices \
  --schedule-expression "cron(0 0 1 * ? *)" \
  --schedule-expression-timezone "UTC" \
  --flexible-time-window '{"Mode":"OFF"}' \
  --target '{
    "Arn": "arn:aws:scheduler:::http-invoke",
    "RoleArn": "arn:aws:iam::123456789012:role/EventBridgeSchedulerHttpRole",
    "HttpParameters": {
      "PathParameterValues": [],
      "QueryStringParameters": {},
      "HeaderParameters": {
        "Authorization": "Bearer FSDEV_SCHEDULER_SECRET_VALUE",
        "Content-Type": "application/json"
      }
    },
    "Input": "{\"nominalFireTime\":\"<aws.scheduler.scheduled-time>\"}",
    "RetryPolicy": {
      "MaximumRetryAttempts": 3,
      "MaximumEventAgeInSeconds": 3600
    },
    "DeadLetterConfig": {
      "Arn": "arn:aws:sqs:us-east-1:123456789012:scheduler-dlq"
    }
  }' \
  --target-uri "https://app.example.com/api/flows/billing/schedules/monthly-invoices/dispatch"
```

EventBridge sends a `POST` to the schedule's dispatch URL,
`/api/flows/<flow>/schedules/<name>/dispatch`, with the two headers and
the JSON body above. The endpoint reads only `nominalFireTime` from the
body. It refuses an `idempotencyKey` and ignores any other field.

Replace `FSDEV_SCHEDULER_SECRET_VALUE` with the value of the
`FSDEV_SCHEDULER_SECRET` environment variable that the flow's
`resolvePrincipal` checks. The value is stored on the schedule, so rotating
the secret means updating the schedule. The bearer helper takes one
`secret`. To accept the old and the new secret while you rotate, write
`resolvePrincipal` yourself. Until the schedule is updated, calls with the
old token get `401`, retry, and land in the dead-letter queue.

The body carries the scheduled time as `nominalFireTime`, which EventBridge
fills in for each run. The command sets the flexible time window to `OFF`, so each call goes out at
the scheduled time.

## Who the run belongs to

Every call goes through the flow's `resolvePrincipal` before anything
runs. The Cloud Scheduler recipe sets it to
`createBearerSecretPrincipalResolver({ secret, principal: { userId: "system", orgId: "org_sys" } })`
with `requireUser: true`, so the run belongs to that fixed principal, the `system`
user. The same check keeps a stranger out. A wrong token gets
`401 unauthorized`. A call with no bearer header resolves to no user, and
`requireUser: true` refuses it with `401`.

## Retries and the dead-letter queue

EventBridge Scheduler retries a call that gets a non-2xx answer, following
the `RetryPolicy`. Each scheduled time runs at most once, however many
times AWS retries it: a repeat answers `200 { status: "duplicate" }`. Calls
that fail past the retry budget land in the `DeadLetterConfig` SQS queue
with the original payload, so you can alert or replay. What a retry does
once a later scheduled time has fired is in
[Schedules](../../reference/schedules.md).

A fire the flow accepts answers
`202 { status: "accepted", scheduleId, origin: "static", requestId }`. That
means the block started, not that it finished. If the block fails after the
`202`, AWS does not retry. Look up the request by its `requestId` with
`GET /api/flows/billing/requests/<requestId>/status?include_result_output=true`
and the same bearer header: its `status` is `errored` and the error is in
its result. See [Errors](../../reference/errors.md).

## Time zones

`--schedule-expression-timezone` is the zone AWS evaluates the cron in. Set
the schedule's `timezone` on the flow to the same zone. If the zones differ,
the endpoint refuses each fire with `400 not_a_scheduled_time`, as in step 1.
See [Schedules](../../reference/schedules.md).

## What it won't do

- Keep setup small. You need an IAM role for the target, which Vercel Cron
  and Cloud Scheduler don't ask for. Choose it when you need a dead-letter
  queue.
- Change the block's input per fire. The block's input comes from the
  schedule's `input`, a value or a function, not from the EventBridge job.
  See [Schedules](../../reference/schedules.md).
