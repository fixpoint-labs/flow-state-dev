---
"@flow-state-dev/workspace": minor
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/fsdev": minor
---

Choose where a coding session starts, and remove what it left on disk (FIX-2419).

- `@flow-state-dev/workspace`: a `baseRef` naming a pinned remote's branch (`origin/main`) in a listed repository is fetched before the cut, and refused as `remote-unreadable` when the fetch fails. `PlaceRequest.existing` checks a branch out instead of cutting one, making it from the remote's when absent (`no-such-branch` when there is none). `localWorkspaceHost` gains `list()` and `remove(target, { deleteBranch?, force? })`, the one removal path, which refuses uncommitted work (`uncommitted-work`), a place mid-provision (`place-busy`) and, unless forced, deleting a branch that holds the only copy of a commit (`unique-commits`). `pullRequestHead` resolves a same-repository pull request to its head branch. `occupyWorktree` holds a worktree in use (`<dir>.lock`), and `remove` refuses one a run holds (`in-use`); `checkedOutBranch` reads the branch a worktree is on.
- `@flow-state-dev/harness-manager`: harness session state gains `start` (`{ base } | { branch } | { pullRequest } | { worktreeOf }`, fixed at create like `model`) and a server-owned `workspace` record. `HarnessSessionWorkspace.provision(place, { start })` may return `{ path, branch }`; the turn-end pull-request check reads the recorded branch. A `removeWorktree` action, refused while a turn runs, calls the workspace's optional `remove`. `resolveHarnessSessionStart` maps a start to a workspace host's request. `{ worktreeOf: sessionId }` attaches a session to another session's worktree and branch: refused at create (404) when that worktree isn't there in the caller's tenant, each turn holds the same in-use lock as the owner's, only the owner may `removeWorktree`, and an attached turn that leaves the worktree on another branch is recorded as failed. The workspace record carries `owner`.
- `@flow-state-dev/fsdev`: `fsdev worktrees <root>` lists a workspace host's worktrees and removes one with `--remove`.
