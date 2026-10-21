---
"@flow-state-dev/workforce": minor
"@flow-state-dev/shift-manager": patch
---

Recurring work: a schedule in the user's schedule collection (`workforce/schedules/*`) files an ordinary task on the board of the worker its `input.filer` names, in the user's own conversation with that worker, as the user, each time it is due. The roster flow keeps and fires them, and gains `saveSchedule`, `deleteSchedule` and `listSchedules`, whose `nextRunAt` is worked out from each schedule's cron and time zone at read. `hireWorkforce(installation, { schedules: { index } })` mirrors them into a schedule index. Every session-board flow gains the internal `fileScheduledTask` entry, which files through the board's own `dispatchTask_tasks`. Shift Manager lists them on a new Scheduled work screen (FIX-2085).
