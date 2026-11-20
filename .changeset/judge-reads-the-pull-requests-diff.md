---
"@flow-state-dev/workspace": patch
"@flow-state-dev/harness-manager": patch
---

A coding run that merged its moved-on base branch into its own branch is now judged and reviewed on its own work: the judge's commit count, subjects and diff, and the review card's files, match the pull request's diff (where the branch meets the base branch's tip now), not everything since the commit the branch was cut at (FIX-2859).

- **workspace:** `WorkspaceHost` has a new optional method, `baseTip({ cwd, baseRef })`: the commit the run's base branch is at now, fetched from the remote the host pinned, into the checkout's object store. It answers only a commit that fetch brought, never a local branch or tracking ref a run could move, and `undefined` for a checkout outside a listed repository, a base named only as `HEAD` (whichever branch the repository is on when asked), a base with no pinned upstream, or a failed fetch. `localWorkspaceHost` implements it; a custom host may leave it out.
- **harness-manager:** at settle the manager asks the host for the tip once and reads the run's commits, its diff and a round's commits against it, when it has the recorded cut in its history (`effectiveCut`). Any other tip, or none, leaves the cut as the base, as before: the reads can over-report the base's commits, never hide the run's. The commit the settle read against is kept on the run record (`effectiveCut`, `null` on older records) on every settle, so a file's patch opened from the `changes` view later matches the review's files and the judge's read; `baseCommit` stays the commit the branch was cut at. Every commit and diff read now ignores replace refs, grafts and the commit-graph in the run's checkout, so a run can't rewrite the base's history to hide its own commits.

Docs: packages/workspace/README.md (the `WorkspaceHost` method list: `baseTip`)
