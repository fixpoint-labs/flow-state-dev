---
"@flow-state-dev/scheduled": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/core": patch
---

A schedule created with `schedules.create(key, { cron, kind, enabled })` on a `defineScheduleCollection` collection now fires: the resolver reads the row from resource state, and a new `stampOrgId` collection option records the creating run's organization on the row (FIX-1545).
