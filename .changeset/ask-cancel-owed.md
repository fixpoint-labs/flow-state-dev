---
"@flow-state-dev/orchestration": patch
---

A stopped or timed-out ask whose own cancel of its task fails no longer leaves the task open. The failed cancel is recorded on the row as `Task.cancelOwed`, and the next `resumeOwedAsks` touch cancels the row. Whatever ends the row clears the marker, and that ending owes the stopped turn no resume. Both built-in backings implement the new optional `TaskCollectionRef.markCancelOwed` (change kind `cancel_owed`), and `TaskFilter.cancelOwed` matches marked rows. A failed cancel no longer surfaces as a tool error on a timed-out ask: the call still answers `wait_timed_out` (FIX-1844).
