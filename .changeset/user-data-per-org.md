---
"@flow-state-dev/engine": minor
"@flow-state-dev/scheduled": minor
"@flow-state-dev/vercel": minor
"@flow-state-dev/bullmq": minor
"@flow-state-dev/testing": minor
---

Every flow now keeps a user's data per organization, so `resolveUserStorageKey(userId, orgId, flow)` takes the organization and throws without one, a dynamic schedule's dispatch id is `<orgId>/<userId>/<key>` (built by the new `formatScheduleId`), and the test harness seeds user data in the run's organization (FIX-1790).
