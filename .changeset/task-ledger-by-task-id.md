---
"@flow-state-dev/orchestration": minor
---

A partitioned task ledger finds a task id through its own declared `byTaskId` index (FIX-2532).

- `defineTaskCollection({ partitionBy })` declares `byTaskId` on the ledger, and `findTaskPartitions` answers through `findBy`: on SQLite and Postgres it reads the index, elsewhere it scans the user's rows. Tasks an older version added are found: the first lookup in each user's scope indexes the rows already there.
- `taskLedgerResources(ledger)` returns the ledger alone. The `<ledger id>__ids` collection is gone, and the `__ids` rows an older version wrote are no longer read or written; they can be left in the store or deleted.
- `taskIdIndexKey` is removed from `@flow-state-dev/orchestration/tasks`.
