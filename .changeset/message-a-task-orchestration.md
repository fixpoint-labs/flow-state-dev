---
"@flow-state-dev/orchestration": minor
---

A partitioned task ledger now keeps an id index, so `findTaskPartitions` finds a task by id alone; declare its resources with `taskLedgerResources(ledger)` instead of the ledger's own resource entry, or adding a task fails naming the missing index. `rowsInSession` lists the rows a session works (FIX-2160).
