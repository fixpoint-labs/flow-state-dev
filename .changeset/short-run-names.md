---
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/workspace": minor
---

A coding task's branch and worktree folder are now one short name made from the task's title, so its pull request can be pushed to GitHub (FIX-2657).

- **harness-manager:** a board run's branch is `conductor/<name>` and its folder `<root>/<name>`, where the name is a slug of the task's title (led by the tracker issue when the task names one, at most 32 characters) and 6 hex of the run's identity, for example `conductor/fix-2657-cap-failed-at-five-3f9a1c`. The full ref stays under 100 bytes. Before, the branch spelled the tenant, organization, user and board out as full digests, and a run on a conversation's board pushed a ref over GitHub's 255-byte limit, which GitHub refused (`GH005`). When another run holds the name, or another worktree or branch already has it, a new run takes `-2`, `-3` and so on. A run already under way keeps the branch and folder its record names. The worktree's `name` in the `worktrees` resource is the same name. New exports from `@flow-state-dev/harness-manager/checkout`: `runName`, `freeRunLocation`, `worktreeNameFor`, `runIdentityKey`, `locationFor`. **Behaviour change for hosts deriving a run's place themselves:** `branchFor`, `checkoutPathFor` and `provisionCheckout` now give the short shape. For a run recorded in the old long shape, find its location with `locationFor(location, recordedBranch)`, or pass `nested: true`.
- **workspace:** `WorkspaceHost.reserve` reserves a place's and branch's names for one run, atomically, refusing a name another run holds or a worktree or branch already has. The local host keeps the holder in a `<place>.holder` file beside the place. A host without it gives a run its derived name as it is. `WorktreeRecording.name` sets a worktree's name when the caller already named the worktree.

Docs: packages/harness-manager/README.md (where a run's checkout and branch are, and what they are named), packages/workspace/README.md (`reserve`, `WorktreeRecording.name`)
