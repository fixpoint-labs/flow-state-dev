---
"@flow-state-dev/workspace": minor
"@flow-state-dev/harness-manager": minor
---

Add a shared list of worktrees (FIX-2439).

- `@flow-state-dev/workspace`: `worktreesCollection` is a user-scoped, `llmReadable` collection with one row per worktree a host made. A row holds `name`, `path`, `branch`, `repo`, `baseCommit`, `owner`, `attached`, `state`, `commits`, `lastTurnAt` and `pullRequests`. To have the host write rows, give it the collection: `PlaceRequest.worktrees` writes `provisioning`, then `ready`; the new `host.attach` adds a session to `attached`; the new `host.recordCheckout` writes the branch and commit count together at a turn's end; and `RemoveOptions.worktrees` marks the row `removed`. `recordBranchPullRequests` takes `worktree: { collection, key }`. `WorkspacePlace.worktree` is the row's key.
- `@flow-state-dev/harness-manager`: the session flow declares the collection and passes it to `HarnessSessionWorkspace`: on `provision` and `remove`, and on the new optional `attach` and `recordCheckout`. It stores the row's key as `state.workspace.worktree`. The board manager writes a row for each run's checkout.
