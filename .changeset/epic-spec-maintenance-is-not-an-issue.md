---
---

Internal (process): correcting a converged epic-spec is a commit on its open PR, not a new issue with its own spec.

**What happened.** A fold pass on the FIX-939 epic-spec found a tail of stale restatements, judged them "below the bar for another pass but above the bar for silence", and filed them as a Linear issue. That issue was a non-terminal child of the epic carrying no category label, so the wake's discovery pass admitted it and the route derivation defaulted to `spec` (fail-closed, on the reasoning that an unnecessary document beats ungated code). A worker then wrote a three-hundred-line spec with seven sign-off decisions and opened a second PR, to make about forty lines of edits to a document that was sitting open and editable the entire time. Two automated reviewers independently reported that the spec was heavier than the work it described.

**Why it happened.** Three things compounded, and each looked locally reasonable. The two-round convergence budget — which exists to stop review loops grinding — was read as closing the *document* rather than just the folding, so a known uncontested correction had no mechanism left. Discovery has no notion of work that is not a lifecycle: every non-terminal child absent from the carried rows enters at its route's entry phase. And the `spec` default, correct for code, produces exactly the unnecessary document when the deliverable is a doc edit.

Review also surfaced that the wake cannot perform the corrective commit itself — at budget it routes converged epic-PR feedback to the sub-issues each item names, and an item concerning no sub-issue is dropped with the cursor. So the coordinator has to notice one and dispatch an `epic-agent` fold for it; the docs now say so rather than implying the machinery handles it.
