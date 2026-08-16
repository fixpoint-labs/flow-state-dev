---
---

Internal: `@flow-state-dev/conductor` (private, unpublished) — a restart no longer buys a second paid pass over feedback conductor already handled.

The observation cursor is persisted at the very end of a tick, deliberately: persisting it before reducing would lose signals permanently and strand a work item at a gate nothing releases. The cost of that ordering was never bounded. A process killed after an `addressFeedback` dispatch had *completed* and before the cursor write came back to a comment the cursor never learned about, re-observed it, and dispatched a second paid agent run against feedback that had already been answered — landing a second set of edits on the branch on top of the first. The ledger row and the settled dispatch record both said the pass had run; the tick consulted neither.

The re-observation is kept — losing it is the worse failure — and is now read against what is on disk. A comment is dropped from the queue when the ledger holds its reduction **and** the pass that reduction bought has settled. Both facts are required, and the second is the one that matters: a ledger row is written *before* the dispatch it records, so the row alone is satisfied by a run that never happened, and suppressing there would leave a reviewer's comment unanswered for the life of the issue, under a gate that still applies so no stall report fires either. Settled either way, for the same reason a phase's entry work is not re-run after a failure: `decide` has already escalated it, and re-running would loop.

Nothing new is stored. Ledger rows already carry the signal whole, so the comment is identified from what is on disk, and the dispatch is matched to its row by phase, action, and having started no earlier than that row — a revision pass is a pass over everything outstanding on the artifact, which is the same claim the existing in-tick coalescing rests on.

One dependent correction rides along: the dispatch record's `startedAt` was overwritten on settling with the *dispatcher's* account of when it started, replacing the value conductor itself recorded when it handed the work over. The record now keeps conductor's own clock, as the opening write always did. That is what makes the guard above able to fire at all — a vendor that reports the epoch would have silently disabled it rather than failed it.

This closes the window for a comment. Two neighbours on the same seam are untouched and reported separately: a review (`changes_requested` / `review_submitted`) carries no review id on its signal, so a re-observed review has no durable identity to match a ledger row against, and a CI conclusion re-observed after the same crash re-dispatches too.
