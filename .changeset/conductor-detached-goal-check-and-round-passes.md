---
---

Internal: two corrections in `@flow-state-dev/conductor` (private, unpublished).

`dispatch/branch` gains a third plan. `detachedBasePlan` provisions a workspace
detached at `<remote>/<base>` — `fetch <remote> <base>`, then
`checkout --detach <remote>/<base>` — and is asked for by passing
`DETACHED_AT_BASE` in place of a branch name. It owns no ref, so it never
collides on the shared base, and it runs no branch-existence probe: there is no
creation/re-entry question to answer, because the plan is the same on every
pass. `BranchPlan` now carries `kind: "creation" | "re-entry" | "detached"` in
place of `creating`. A post-merge `runGoalCheck` is provisioned this way, so the
proof is taken against what a reader of the base actually gets rather than
against the feature branch the merge superseded — and it can no longer be
diverted by a branch a vendor pushed. Its brief carries no branch, because there
is none to commit onto.

A review round is now counted per handled feedback pass rather than per distinct
head SHA. A pass that answers feedback without pushing a commit leaves the head
where it was, so the old rule counted it as zero: the counter could sit at one
while pass after pass was dispatched and paid for, and the round cap never
parked the loop. Comments arriving in one poll still coalesce into one dispatch
and one round; a later pass on the same head now costs a round of its own.
