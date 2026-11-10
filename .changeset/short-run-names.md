---
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/workspace": patch
---

A coding task's branch and worktree folder are now one short name made from the task's title, so its pull request can be pushed to GitHub (FIX-2657).

- **harness-manager:** a board run's branch is `conductor/<name>` and its folder `<root>/<name>`, where the name is a slug of the task's title (led by the tracker issue when the task names one, at most 32 characters) and 6 hex of the run's identity, for example `conductor/fix-2657-cap-failed-at-five-3f9a1c`. The full ref stays under 100 bytes. Before, the branch spelled the tenant, organization, user and board out as full digests, and a run on a conversation's board pushed a ref over GitHub's 255-byte limit, which GitHub refused (`GH005`). When another worktree or branch already has the name, a new run takes `-2`, `-3` and so on. A run already under way keeps the branch and folder its record names. The worktree's `name` in the `worktrees` resource is the same name. New exports: `runName`, `freeRunLocation`, `worktreeNameFor`.
- **workspace:** `WorkspaceHost.taken` answers whether a place or a branch of a name is already on the host, and `WorktreeRecording.name` sets a worktree's name when the caller already named the worktree.

Docs: packages/harness-manager/README.md (where a run's checkout and branch are, and what they are named), packages/workspace/README.md (`taken`, `WorktreeRecording.name`)
