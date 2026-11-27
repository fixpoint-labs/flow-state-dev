---
"@flow-state-dev/harness-manager": patch
---

A session turn that merges its base branch in now reads as only its own changes (FIX-2861), as a board run's review already does. Its `changes` view leaves out the files the merge brought, for a merge commit and a fast-forward alike.

- **New, optional: `HarnessSessionWorkspace.baseTip(place)`.** The commit the session's base branch is at now, from a source the run can't move (a `WorkspaceHost`'s `baseTip` is one). Read when a turn ends. A host without it reads a turn as before: everything between the commits it started and ended on.
- **A turn's record keeps `mergedBase`**: the newest base commit the turn merged in, or `null`. A turn recorded before it reads as before.
- A tip that already has the turn's own work, and a merge of the turn's start with the base that conflicts, both leave the turn read from its start: more than its own work, never less.

Docs: packages/harness-manager/README.md, where the session flow's workspace options are listed.
