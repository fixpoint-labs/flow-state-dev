---
"@flow-state-dev/orchestration": minor
---

A task write now records what it did, so a caller can tell a committed write from one that never landed (FIX-989).

A task write can commit and then throw. Both collection backings announce the change as a tail call, strictly after the durable write resolves, so a failure anywhere after that write — the announcement, a result recorder, the caller's own code — rejects a call whose write already landed. A rejected promise carries no value, so the `TaskWriteOutcome` verdict never reaches that caller, and reading the task back does not settle it either. A committed retry followed by another worker's claim reads exactly like a write that never landed followed by a reclaim and another worker's claim: both leave the task `in_progress` on one more attempt. The first is a real post-commit failure somebody has to hear about; the second is routine.

Two new exports close it. `beginTaskWrite(task)` mints a token before the write; pass it as `write` on the same `TaskTransitionOptions` argument the advisory guards already use. `didWriteLand(task, token)` then answers `true` (it committed), `false` (it changed nothing) or `undefined` (cannot tell). The token is recorded inside the same atomic write that changes the task, so the answer is exactly as durable as the task and survives the next worker's claim — which is the case a later read cannot reason about on its own.

`undefined` is a first-class answer, not a shrug: surface it as its own condition rather than collapsing it into either boolean. It means the task carries no provenance, the token was minted for a task that has since been deleted and recreated under the same id, or the receipt may have aged out. A task retains its four most recent receipts.

Correlation is available on the seven methods that take `TaskTransitionOptions` — `complete`, `fail`, `block`, `unblock`, `awaitReview`, `resumeFromReview`, `cancel`. `addTask`, `addTasks`, `claim`, `reclaim` and the five field mutators still advance the task's `revision` on every committed write, but take no options object and so carry no token.

The `Task` schema gains three optional fields — `revision`, `writeLog`, `writeLogTruncated` — maintained by the collection, not by callers. Existing tasks carry none of them and keep working: an absent record reads as "cannot tell", never as "your write did not land". The same holds for a `TaskCollectionRef` you wrote by hand, which needs no migration. If you do maintain the fields in a custom ref, advance the revision on every write that changes a task; a write that skips it makes a later answer wrong rather than merely absent.
