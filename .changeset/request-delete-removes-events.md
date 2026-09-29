---
"@flow-state-dev/engine": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

Deleting a request, including through session retention, now also deletes its stream events and runOnce results in the memory, SQLite and Postgres stores, so a later request that reuses the id cannot replay the earlier run (FIX-1647).
