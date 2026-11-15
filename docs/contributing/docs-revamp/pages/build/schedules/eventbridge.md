---
title: Run on a schedule with EventBridge
type: recipe
description: "Have an EventBridge rule call a flow's schedule on a cron through an API destination, with a shared secret, retries and a dead-letter queue."
---

# Run on a schedule with EventBridge

Flow State does not run schedules itself. Your host's scheduler calls an
endpoint, and the flow runs its block. In AWS that caller is an EventBridge
rule on a schedule whose target is an API destination: an HTTPS URL plus a
connection that holds the credentials. EventBridge retries failed calls and
sends the ones that keep failing to a dead-letter queue. AWS calls
scheduled rules legacy and points to EventBridge Scheduler, but
Scheduler's targets are AWS API calls, not URLs.

This recipe makes a rule call `monthly-invoices`, a schedule on the
`billing` flow, on the first of each month. It assumes the scheduled
adapter is mounted and the flow declares the schedule, with
`cron: "0 0 1 * *"` and a `resolvePrincipal` that checks a bearer secret,
as in [Cloud Scheduler](./cloud-scheduler.md). If the adapter is not
mounted, start with [Serving flows](../../concepts/serving-flows.md).

## 1. Convert the cron expression

The flow's `cron` has five fields. EventBridge's has six, a trailing year,
and uses `?` for an unused day field. Write the same schedule in both
places. Don't paste the EventBridge form into the flow: the flow's `cron`
takes exactly five fields, and a six-field expression is refused when the
flow registers, so the app fails at boot. Convert the expression when you
create the rule:

| Flow `cron` | EventBridge `cron(...)` |
| --- | --- |
| `0 0 1 * *` (1st of month, 00:00) | `cron(0 0 1 * ? *)` |
| `0 9 * * MON` (Monday 9am) | `cron(0 9 ? * MON *)` |
| `*/15 * * * *` (every 15min) | `cron(0/15 * * * ? *)` |

EventBridge decides when the call is made. The flow reads its own `cron` to
work out which scheduled time a call is for, so the two must name the same
instants. If they differ, the endpoint answers `400 not_a_scheduled_time`
on every fire. EventBridge does not retry a `400`, so each fire goes
straight to the dead-letter queue. See
[Schedules](../../reference/schedules.md).

## 2. Create the connection, destination and rule

```bash
aws events create-connection \
  --name fsd-scheduler \
  --authorization-type API_KEY \
  --auth-parameters '{
    "ApiKeyAuthParameters": {
      "ApiKeyName": "Authorization",
      "ApiKeyValue": "Bearer FSDEV_SCHEDULER_SECRET_VALUE"
    }
  }'

aws events create-api-destination \
  --name monthly-invoices \
  --connection-arn "<ConnectionArn from create-connection>" \
  --invocation-endpoint "https://app.example.com/api/flows/billing/schedules/monthly-invoices/dispatch" \
  --http-method POST

aws events put-rule \
  --name monthly-invoices \
  --schedule-expression "cron(0 0 1 * ? *)"

aws events put-targets \
  --rule monthly-invoices \
  --targets '[{
    "Id": "dispatch",
    "Arn": "<ApiDestinationArn from create-api-destination>",
    "RoleArn": "arn:aws:iam::123456789012:role/EventBridgeInvokeApiDestination",
    "InputTransformer": {
      "InputPathsMap": { "time": "$.time" },
      "InputTemplate": "{\"nominalFireTime\": <time>}"
    },
    "RetryPolicy": { "MaximumRetryAttempts": 3, "MaximumEventAgeInSeconds": 3600 },
    "DeadLetterConfig": { "Arn": "arn:aws:sqs:us-east-1:123456789012:scheduler-dlq" }
  }]'
```

On each fire EventBridge sends a `POST` to the schedule's dispatch URL,
`/api/flows/<flow>/schedules/<name>/dispatch`. The connection adds the
`Authorization: Bearer ...` header, and EventBridge sets
`Content-Type: application/json` by default. The input transformer copies
the event's `time`, when the rule fired in UTC, into the body as
`{"nominalFireTime": "2026-12-01T00:00:00Z"}`. The endpoint reads only
`nominalFireTime`, refuses an `idempotencyKey` and ignores other fields.

`RoleArn` is a role EventBridge assumes, allowed
`events:InvokeApiDestination`. The dead-letter queue needs a policy letting
`events.amazonaws.com` call `sqs:SendMessage`.

Replace `FSDEV_SCHEDULER_SECRET_VALUE` with the value of the
`FSDEV_SCHEDULER_SECRET` environment variable that the flow's
`resolvePrincipal` checks; it can't contain a colon. The value lives on the
connection, so rotating the secret means `aws events update-connection`.
The bearer helper takes one `secret`. To accept the old and the new secret
while you rotate, write `resolvePrincipal` yourself. Until the connection
is updated, calls get `401`, which EventBridge retries until the retry
policy runs out.

## Who the run belongs to

Every call goes through the flow's `resolvePrincipal` before anything
runs. The Cloud Scheduler recipe sets it to
`createBearerSecretPrincipalResolver({ secret, principal: { userId: "system", orgId: "org_sys" } })`
with `requireUser: true`, so the run belongs to that fixed principal, the `system`
user. The same check keeps a stranger out. A wrong token gets
`401 unauthorized`. A call with no bearer header resolves to no user, and
`requireUser: true` refuses it with `401`.

## Retries and the dead-letter queue

An API destination retries a `401`, `409`, `429`, any `5xx` and a call
with no answer within 5 seconds, following the `RetryPolicy`. Other `4xx`
answers, such as step 1's `400`s, are not retried. Each scheduled time runs
at most once, however many times AWS retries it: a repeat answers
`200 { status: "duplicate" }`. Calls that fail for good land in the
`DeadLetterConfig` SQS queue, so you can alert or replay. What a retry does once a later scheduled time has
fired is in [Schedules](../../reference/schedules.md).

A fire the flow accepts answers
`202 { status: "accepted", scheduleId, origin: "static", requestId }`. That
means the block started, not that it finished. If the block fails after the
`202`, AWS does not retry. Look up the request by its `requestId` with
`GET /api/flows/billing/requests/<requestId>/status?include_result_output=true`
and the same bearer header: its `status` is `errored` and the error is in
its result. See [Errors](../../reference/errors.md).

## Time zones

A rule's cron runs in UTC, with no zone option. Leave the schedule's
`timezone` on the flow at its default, `"UTC"`; another zone gets
`400 not_a_scheduled_time` on each fire. A schedule that follows daylight
saving can't be one UTC rule. See
[Schedules](../../reference/schedules.md).

## What it won't do

- Keep setup small. You need a connection, an API destination, a rule, an
  IAM role for the target and a queue policy, which Vercel Cron and Cloud
  Scheduler don't ask for. Choose it when you need a dead-letter queue.
- Change the block's input per fire. The block's input comes from the
  schedule's `input`, a value or a function, not from the EventBridge rule.
  See [Schedules](../../reference/schedules.md).
