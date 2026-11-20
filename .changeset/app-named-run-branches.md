---
"@flow-state-dev/harness-manager": minor
---

A coding run's branch now starts with the app's own prefix instead of `conductor/` (FIX-2857). `harnessManager({ branchPrefix })` and the harness kit's `harnesses({ branchPrefix })` take it, such as `"teammates/"`: lower-case letters and digits with single `-` or `_`, ending in `/`, at most 32 characters, refused at construction otherwise. With none set, a new run's branch is `fsd/<name>`. The name and the folder are unchanged, and a run already recorded on a branch, `conductor/…` included, keeps that branch and its worktree.
