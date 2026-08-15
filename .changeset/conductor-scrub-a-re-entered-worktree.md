---
---

Internal: `@flow-state-dev/conductor` (private, unpublished) now hands over a
re-entered worktree clean, so a goal verdict cannot be proved against code that
exists in no revision (LAB-107).

A goal proof is bound to a revision. That binding is only worth what the tree the
command ran in was worth — and a checkout does not clean a tree. Neither
`checkout -B` nor `checkout --detach` discards a working-tree change, so a
worktree conductor re-entered for a second dispatch came back carrying whatever
the last one left uncommitted. A check that passed there proved something that
exists nowhere, and the proof was then recorded against a SHA that did not
describe what actually ran. The other way it ended was a dead dispatch: a
`checkout -B` over a conflicting local change fails outright.

A worktree conductor re-enters is now scrubbed before anything is checked out
into it — tracked changes discarded, untracked files removed. A worktree it just
cut is clean by construction and is left alone, and so is a `cwd` provision:
that workspace is the repo root a human is standing in, and discarding
uncommitted work conductor was never given is a worse failure than the one this
closes.

Ignored files — `node_modules`, build output, a local `.env` — are deliberately
left in place. They sit outside the revision by design, and removing them would
make every review round pay for a reinstall.
