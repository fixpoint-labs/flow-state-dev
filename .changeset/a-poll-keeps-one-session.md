---
"@flow-state-dev/core": patch
"@flow-state-dev/scheduled": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/workforce": patch
---

A schedule can run every fire in one session: `session: "per-schedule"` on a schedule, or on `createResourceCollectionScheduleResolver` for every row it resolves, and the flow's `session.retention` caps that session's history; leaving it out (`"per-fire"`) keeps one one-off run per fire (FIX-2886). The session's id is derived by the framework under the reserved `fsd-schedule.` prefix: only the scheduled dispatch creates it or runs in it, its owner can list and read it, and retry, continue and resume refuse a request in it. Workforce's subscription poll now keeps one session per poll, with a day of history.

Docs: docs/server/scheduled.md
