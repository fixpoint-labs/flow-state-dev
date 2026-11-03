# harness-manager › a session starts where it was asked, and its worktree is removed without losing work

**Issue:** FIX-2419

**Outcome:** A person creating a coding session picks where it starts: a fresh copy of the
remote's branch, or an existing branch to work on as it stands. When they are done, they remove
the session's worktree (and, if they ask, its branch) from the session or from `fsdev worktrees`.
Removal is refused while a turn runs, while the worktree holds uncommitted work, and, for the
branch, while it holds the only copy of a commit unless forced. A follow-up session can attach to
an earlier session's worktree and work there on its branch; the two never write at once, and only
the owner removes it.

**Input:** `fixtures/input.json`: the existing branch's name and the stub's commit subject. The
repository is made fresh each run: a bare remote on disk, the person's clone, and a teammate's
clone that moves the remote's `main` after the person's last fetch.

**Signal:**

- **a:fresh**: a session created with `start: { base: "origin/main" }` is on a branch that
  contains the remote's new tip, which the person's tracking ref did not have.
- **b:on-branch**, **b:recorded**: a session created with `start: { branch }` commits onto that
  branch in the person's repository, and records it as its branch.
- **d:missing-refused**: creating a session with `start: { worktreeOf }` naming a session that
  has no worktree answers 404.
- **d:attached-turn**, **d:on-owner-branch**, **d:recorded**: a session attached to b's session
  commits onto b's branch in b's worktree, cuts no branch of its own, and records b's path with
  b as the owner.
- **d:other-user-refused**: another user's session naming b's session as `worktreeOf` fails its
  turn and commits nothing to b's branch: b's worktree is not in their list.
- **d:remove-refused**: the attached session's `removeWorktree` fails and the worktree stays.
- **d:waits-for-owner**: a turn of the attached session sent while b's turn is held commits
  nothing until b's turn ends; then both complete.
- **c:listed**: `fsdev worktrees <root> --json` lists the session's worktree.
- **c:refused-mid-turn**: `removeWorktree` sent while a turn is held answers 409, and the
  worktree is still there.
- **c:dirty-refused**: with an untracked file in the worktree, `removeWorktree` fails and the
  file is still there.
- **c:branch-refused**, **c:forced**: `deleteBranch` fails while the branch holds the stub's
  commit and no other ref does; with `force` the worktree and branch are gone.
- **c:removed**, **c:unlisted**: a plain removal takes the worktree and keeps the branch, and
  `fsdev worktrees` no longer lists either removed worktree.

**Anti-game:** every assertion reads git in the person's repository, the session's stored state,
or the real CLI's output, never what the host or the flow returns. Leg a checks that the tracking
ref was stale before the session started, so a pass can't come from a ref the setup already had.
The mid-turn refusal goes through the engine's HTTP router, where concurrency is enforced, not
`runAction`.

**Model:** n/a (model-free: a stub harness commits one file per turn).

**Run:** `pnpm tsx goals/harness-manager/session-worktree-lifecycle/run.mts`

**Controls:**

- `GOAL_CONTROL=no-fetch`: the workspace hands the host the commit the stale tracking ref names,
  so nothing is fetched. Must fail **a:fresh** only.
- `GOAL_CONTROL=cut`: the workspace ignores the existing branch and cuts the session's own. Must
  fail **b:on-branch** and **b:recorded** only.
- `GOAL_CONTROL=lose-work`: the workspace removes with `git worktree remove --force`, a second
  removal path. Must fail **c:dirty-refused** only.
- `GOAL_CONTROL=no-attach`: the follow-up asks for b's branch (`start: { branch }`) instead of
  attaching, as a caller had to before. Must fail **d:attached-turn**, **d:on-owner-branch**,
  **d:recorded** and **d:waits-for-owner** only (git refuses a branch checked out elsewhere).
- `GOAL_CONTROL=any-user`: the workspace answers every attach without reading the user's own
  list of worktrees. Must fail **d:other-user-refused** only.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|---|---|---|---|---|
| 2026-10-31 | (impl branch, before push) | n/a | PASS | Each control reddened exactly its legs |
| 2026-11-01 | (impl branch, attach amendment) | n/a | PASS | Leg d added; all four controls reddened exactly their legs |
| 2026-11-01 | (#4472, review fixes) | n/a | PASS | d:other-user-refused added with control any-user; all five controls reddened exactly their legs |
