---
"@flow-state-dev/workforce": patch
"@flow-state-dev/workspace": patch
---

`projectWorkspace({ checkouts })` runs a listed shared project's coding runs in worktrees of a checkout on the server's machine, with the project's kept files beside each worktree, which `localWorkspaceHost`'s `localRepositories` now supports (FIX-1906).
