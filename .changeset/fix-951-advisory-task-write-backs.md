---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/patterns": patch
---

A task board no longer abandons the rest of its work when one worker's result lands on a task that was already settled. Cancelling a task does not stop the worker running it, so a worker that finishes normally — or throws — on a cancelled task used to make the board's own write-back an illegal transition, which threw from inside the per-worker rescue, abandoned every sibling task, and reported an error about bookkeeping instead of about what actually went wrong.

`TaskCollectionRef.complete` and `fail` now take an optional `TaskTransitionOptions` third argument. `ifAllowed` records the outcome only if the state machine will take it and the task is not already settled; `expectAttempt` records it only if the caller still holds the claim, which matters because a stale result after a lease reclaim is a perfectly legal transition. Both are evaluated inside the atomic write, and only those two outcomes go quiet — a missing task or a store failure still throws. Direct callers that pass no options keep today's throwing contract exactly.

The substrate's six containment write-backs opt in across both collection backings, so a settled task's status now stands and the worker's real error is the one that surfaces. On the resource backing a declined write also no longer emits a `resource_change` for a write that did not happen, which previously could wake a `reactTo.stateUpdated` block.
