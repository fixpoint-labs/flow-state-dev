---
"@flow-state-dev/scheduled": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/core": minor
---

A schedule created with `schedules.create(key, { cron, kind, enabled })` on a `defineScheduleCollection` collection now fires and keeps firing after a reschedule: the resolver reads the row from resource state (`ScheduleResolutionStores` now requires `resourceState`), and a new `stampOrgId` collection option records the creating run's organization on the row, keeps it across updates, and refuses any write that names another organization (FIX-1545).
