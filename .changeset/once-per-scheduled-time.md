---
"@flow-state-dev/scheduled": minor
"@flow-state-dev/core": minor
"@flow-state-dev/bullmq": patch
---

The scheduled-dispatch endpoint fires each scheduled time at most once, across retries, restarts and hosts that share a SQLite or Postgres store. It keeps one record per schedule in the host's resource-state store, the latest time it fired, and claims it with compare-and-set before the schedule's handler runs. A fire carrying `nominalFireTime` counts against that scheduled time (within 5 s); one carrying none counts against the latest scheduled time already due. A time already fired, or earlier, answers `200 { status: "duplicate" }`. A carried time that is no scheduled time of the cron answers `400 not_a_scheduled_time`, one not yet due `400 not_yet_due`. A fire that isn't admitted gives its time back unless a later one fired. `metadata.schedule.nominalFireTime` is the scheduled time the fire counted against (FIX-2085).

Removed outright, with no deprecation release: teams outside the repo rewrite at upgrade.

| Removed | Use instead |
|---|---|
| `createScheduledTransportAdapter`'s `idempotencyWindowMs` | Nothing: the endpoint fires each scheduled time at most once, recorded in the host's store. Passing it throws, naming the change |
| `createScheduledTransportAdapter`'s `idempotencyOptions` (the cache's test seam) | Nothing: it goes with the cache. Passing it throws |
| The dispatch request body's `idempotencyKey` | Nothing: the scheduled time is the key. A body that sends one is refused with `400 idempotency_key_removed` |

A host that sent its own clock as `nominalFireTime` sends the scheduled time instead, or no body. A late retry of a missed time, or one delivered after the next time fired, answers `duplicate` and runs nothing.

`@flow-state-dev/scheduled/collection` is a new entry with the schedule collection, its resolver, `formatScheduleId` and `parseNextFireAt`, loading no engine. The resolver reads a user's row through the new `ScheduleResolutionContext.userStorageKey`, which the dispatch endpoint supplies; code that builds that context itself (a test calling a resolver directly) passes it.

The BullMQ dispatch worker sends the job's scheduler slot (`opts.prevMillis`) as `nominalFireTime`, not `job.timestamp`, the job's creation time, which is no scheduled time.
