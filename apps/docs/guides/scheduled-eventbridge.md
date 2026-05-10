---
sidebar_position: 12
title: Scheduled actions on EventBridge Scheduler
---

# Scheduled actions on EventBridge Scheduler

EventBridge Scheduler fires HTTPS targets on a schedule with retries,
flexible time windows, and dead-letter queues. It maps to the
scheduled-actions transport over its public-HTTPS target type, but
the cron dialect differs from the framework's POSIX 5-field syntax.

This guide assumes the scheduled adapter is already mounted. If not,
start with [Scheduled actions](/docs/server/scheduled).

## Cron dialect note

The framework validates static schedules as POSIX 5-field cron at
flow registration. EventBridge cron expressions are 6-field with a
non-standard `?` semantic and a different day-of-week dialect.

This is a notation difference at the AWS side, not a framework
constraint. Adapt at job creation:

| Framework cron | EventBridge cron |
| --- | --- |
| `0 0 1 * *` (1st of month, 00:00) | `cron(0 0 1 * ? *)` |
| `0 9 * * MON` (Monday 9am) | `cron(0 9 ? * MON *)` |
| `*/15 * * * *` (every 15min) | `cron(0/15 * * * ? *)` |

The `cron` field on the framework's `ScheduleConfig` is display-only
metadata — it does not drive evaluation. Treat the AWS expression as
the source of truth and the framework expression as documentation.

## Creating a schedule

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
    "Input": "{\"nominalFireTime\":\"2026-06-01T00:00:00Z\"}",
    "RetryPolicy": {
      "MaximumRetryAttempts": 3,
      "MaximumEventAgeInSeconds": 3600
    },
    "DeadLetterConfig": {
      "Arn": "arn:aws:sqs:us-east-1:123456789012:scheduler-dlq"
    }
  }' \
  --target-uri "https://app.example.com/api/flows/billing/schedules/monthlyInvoices/dispatch"
```

The header value is templated at create time. To rotate the secret,
update the schedule (or front the call with API Gateway and verify
there).

## DLQ and retries

EventBridge Scheduler retries non-2xx responses according to the
`RetryPolicy`. A request that retries within the framework's
idempotency window (default 60s, configurable) returns
`200 { status: "duplicate" }` on the retry — the action does not run
twice. Failures past the retry budget land in the configured
`DeadLetterConfig` SQS queue with the original event payload, so the
host can alert or replay.

If the action itself errors after the dispatch returned 202, AWS does
not retry — the dispatch was successful from its perspective. The
error lands on the `RequestRecord` and surfaces in DevTool.

## Time zones

`--schedule-expression-timezone` is the cron evaluation zone on the
AWS side. As with Cloud Scheduler, the framework treats
`schedule.timezone` as opaque metadata. Set both to the same value
for consistency.

## Limitations

- IAM and target role setup is operationally heavy compared to
  Vercel Cron or Cloud Scheduler. Worth it for the retry and DLQ
  story when you have actual durability requirements.
- The schedule expression is fixed at create time. Per-fire dynamic
  input must come from the action computing it from `nominalFireTime`
  or scope state, not from the EventBridge config.
