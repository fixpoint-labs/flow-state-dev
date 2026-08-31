---
---

Conductor (lab, LAB-147): the ask marker's do-not-commit rule is checked in the repository the marker lands in.

A run writes the question it needs answered to `<checkout>/.fsdev/ask/<attempt>.md`, and nothing must commit it. That rested on this repository's `.gitignore` carrying a double-star `.fsdev` rule — but the marker lands in the product checkout, a worktree of `workspace.sourceRepo`, which the conductor requires be a different repository. A target that never adopted the pattern has no such rule, so the coding agent's own `git add -A` would stage the marker and it would land in a commit on the branch.

Provisioning now asks git, in the checkout, whether that path is ignored, and refuses the checkout with the line to add if it is not. Checked on reuse as well as on creation, because the rule is a tracked file the run can delete.

Internal to `labs/conductor`; no published package surface changes.

A refusal discards the checkout it just created, and that cleanup runs after the provisioning budget it could not draw from. The lock's advertised lifetime now carries the allowance for it, so an `ownership.staleAfterMs` sized against the old two-term bound is refused at construction rather than letting a waiter clear a lock while its holder is still cleaning up.

A refusal on a branch that outlives it — one reused from a previous attempt, or a pre-existing branch the cleanup deliberately keeps — now names that branch. The tree is on a commit cut before the fix, so fixing the source repository alone leaves it unchanged; the message says to bring it up to date or delete it rather than advertising a recovery that does not apply.

The lock-lifetime bound counts the cleanup allowance against the run timeout rather than alongside it: a refusal throws before any agent is dispatched, so the two tails are mutually exclusive and adding both would reject configurations that are in fact safe. And the cleanup wears the interrupted-provision marker while it deletes, so a delete cut short leaves a leftover the next attempt identifies and clears rather than one it refuses by hand.

The run is told to keep `.fsdev/` out of its commits rather than told the ignore rule will do it. Provisioning checks that rule before dispatch, and `.gitignore` is a tracked file the run may itself rewrite — so a promise that the marker cannot be committed is one nothing can keep for the length of a run, and a run given that reassurance has no reason to check what it staged.

The already-tracked refusal is limited to files whose names a run could actually write. Tracked and ignored are independent, so a target can carry the rule and still keep a `.gitkeep` or a README inside the directory it excludes — that sibling makes git descend, but an untracked marker there stays ignored and uncommittable, so refusing on it turned away a repository that was never at risk.

Marker classification no longer re-tests the directory prefix case-sensitively. Where the filesystem folds case, git resolves `.FSDEV/ask/1.md` and `.fsdev/ask/1.md` to one file, so the listing can carry a spelling the run never uses — and it is exactly the file the run would collide with.

On a reused checkout the refusal now says to remove the tree before deleting the branch. Git refuses to delete a branch a worktree still has checked out, and reuse leaves that tree standing on purpose — so the shorter advice was a command git rejects.
