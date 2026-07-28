---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/patterns": patch
---

A task board no longer abandons the rest of its work when one worker's result lands on a task that was already settled. Cancelling a task does not stop the worker running it, so a worker that finishes normally — or throws — on a cancelled task used to make the board's own write-back an illegal transition, which threw from inside the per-worker rescue, abandoned every sibling task, and reported an error about bookkeeping instead of about what actually went wrong.

`TaskCollectionRef.complete` and `fail` now take an optional `TaskTransitionOptions` third argument. `ifAllowed` records the outcome only if the state machine will take it and the task is not already settled; `expectAttempt` records it only if the caller still holds the claim, which matters because a stale result after a lease reclaim is a perfectly legal transition. Both are evaluated inside the atomic write, and only those two outcomes go quiet — a missing task or a store failure still throws. Direct callers that pass no options keep today's throwing contract exactly.

Every containment write-back in the substrate opts in, so a settled task's status now stands and the worker's real error is the one that surfaces. A declined write also no longer emits a `resource_change` for a write that did not happen, which previously could wake a `reactTo.stateUpdated` block.

**If you implement `TaskCollectionRef` yourself, this needs a change from you.** Boards built the two ways the framework constructs collections — the `backing` specs and `defineTaskCollection` — get the fix for free. A board given a caller-supplied `(ctx) => TaskCollectionRef` factory does not: an existing `complete(id, output)` / `fail(id, error)` still satisfies the interface, because the new argument is optional and JavaScript drops the extra one. Nothing errors and nothing type-checks differently — the board simply keeps abandoning its siblings. Accept the third argument and honour it: decline the write when `ifAllowed` is set and the task is already terminal or the transition is disallowed, and when `expectAttempt` is set and it does not match `task.attempts` on a task that is still `in_progress` or `awaiting_review`. Evaluate both inside your atomic write. This is why the bump is `minor` rather than `patch`.
