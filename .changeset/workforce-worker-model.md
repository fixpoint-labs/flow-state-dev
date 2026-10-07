---
"@flow-state-dev/workforce": minor
"@flow-state-dev/orchestration": patch
---

Workers can be data: `createWorkerInstallation` gives a worker flow a create check that names the session's worker once, `resolveWorker` loads it each turn, `createWorkerHireBlocks` writes the user's roster, and `createWorkforceClient` finds or starts a session with a worker. `writeShared` now names the worker the turn loaded, not a `seatId` setting. `createSkillsLibrary` takes `partitionBy` to keep one catalog per party on one flow copy (FIX-1788).
