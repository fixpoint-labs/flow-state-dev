---
"@flow-state-dev/orchestration": minor
---

A partitioned task ledger finds a task id through its own declared `byTaskId` index (FIX-2532).

- `findTaskPartitions` uses an index on SQLite and Postgres and scans the user's rows on other stores. Tasks added by an older version are found too: on SQLite and Postgres, the first lookup in each user's scope indexes the rows already there.
- `taskLedgerResources(ledger)` returns the ledger alone. The `<ledger id>__ids` collection is gone, and the `__ids` rows an older version wrote are no longer read or written; they can be left in the store or deleted.
- `taskIdIndexKey` is removed from `@flow-state-dev/orchestration/tasks`.
