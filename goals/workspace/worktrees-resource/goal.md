# workspace › every worktree has one row in the user's list, kept current by the host

**Issue:** FIX-2439

**Outcome:** Each worktree the workspace host makes for a coding session has one row in the
user's `worktrees` collection. The host writes the row, and every session of that user can read
it: its name, path, branch, base, owner, attached sessions, state, and commit count. The row
shows the worktree as it is after the latest turn, and it stays after the worktree is removed.

**Input:** `fixtures/input.json`: the first session's title and the stub's commit subject. The
repository is made fresh each run: a bare remote on disk and the person's clone, listed as
Kitchen Sink lists its own.

**Signal:**

- **a:row**: after the first turn there is one row, `ready`, with the session's path and
  branch, `baseCommit` equal to `git merge-base main <branch>`, the session as owner, and a name
  `fix-the-export-button-<6 hex>`.
- **a:key**: the session's `state.workspace.worktree` is that row's key.
- **b:attached**: a second session created with `start: { worktreeOf }` runs a turn. The row
  lists it in `attached`, its owner is unchanged, and the second session stores the same key.
- **c:snapshot**: a turn commits twice and then switches to a new branch. The row names the new
  branch, its `commits` equals `git rev-list --count HEAD --not <baseCommit>`, and
  `lastTurnAt` is from that turn.
- **d:removed**: after `removeWorktree`, the row is still there, `removed`, with its path.
- **e:same-user**, **e:other-user**: a new session of the same user lists the row through the
  flow's resource route. A session of another user lists no rows.

**Controls:** each one reddens exactly the legs named.

- `GOAL_CONTROL=no-row`: the workspace provisions without the collection. Every leg that reads
  a row fails.
- `GOAL_CONTROL=no-checkout`: the workspace has no `recordCheckout`. Fails **c:snapshot**.
- `GOAL_CONTROL=keep-ready`: the workspace removes with `git worktree remove`, not the host.
  Fails **d:removed**.
