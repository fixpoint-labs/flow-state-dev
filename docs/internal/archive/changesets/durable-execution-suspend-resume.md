---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
---

Add durable execution with suspend/resume for human-in-the-loop workflows and crash recovery. Blocks can call `ctx.suspend()` to pause execution and wait for external input; the resume endpoint re-invokes the action with skip-and-inject replay. Native SuspensionStore and LeaseStore adapters ship for filesystem, SQLite, and Postgres.
