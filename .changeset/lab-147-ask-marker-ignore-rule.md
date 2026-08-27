---
---

Conductor (lab, LAB-147): the ask marker's do-not-commit rule is checked in the repository the marker lands in.

A run writes the question it needs answered to `<checkout>/.fsdev/ask/<attempt>.md`, and nothing must commit it. That rested on this repository's `.gitignore` carrying a double-star `.fsdev` rule — but the marker lands in the product checkout, a worktree of `workspace.sourceRepo`, which the conductor requires be a different repository. A target that never adopted the pattern has no such rule, so the coding agent's own `git add -A` would stage the marker and it would land in a commit on the branch.

Provisioning now asks git, in the checkout, whether that path is ignored, and refuses the checkout with the line to add if it is not. Checked on reuse as well as on creation, because the rule is a tracked file the run can delete.

Internal to `labs/conductor`; no published package surface changes.

A refusal discards the checkout it just created, and that cleanup runs after the provisioning budget it could not draw from. The lock's advertised lifetime now carries the allowance for it, so an `ownership.staleAfterMs` sized against the old two-term bound is refused at construction rather than letting a waiter clear a lock while its holder is still cleaning up.
