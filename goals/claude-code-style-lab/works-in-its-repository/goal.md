# claude-code-style-lab › it works in its repository

**Issue:** FIX-2628 (epic FIX-2618)

**Outcome:** In the Claude Code-style lab, a coding run works in the repository its session was
opened on. With two repositories registered, a session on the second files a coding task through
its lead, and the run's worktree belongs to the second repository, never the first. Neither
person's own checkout moves.

**Input:** `fixtures/input.json`: two repositories, each a name, a branch and uncommitted files
(each is committed on `main`, then left dirty on its own branch), and a held-out coding task's
title and goal. No worker file, flow or page names any of it.

**Signal:** `fsdev dev --config labs/claude-code-style/fsdev.config.mts --app
@flow-state-dev/claude-code-style`, a fresh data folder, both repositories in
`CLAUDE_CODE_STYLE_REPOSITORIES`, every coding task on harness-manager's scripted coder
(`CLAUDE_CODE_STYLE_HARNESS=stub`). Over the public client, as the page does:

- a session with `desk.lead` (the coordinator flow) is created and opened on the second
  repository: workforce's `setSessionFields` writes its `repository`, on the server;
- the lead's board files the task for `desk.thread-coder` (`createTask_tasks`), as the lead's turn
  does;
- **second**: within 90 s, the second repository's `git worktree list` names a worktree under the
  data folder;
- **first**: the first repository's `git worktree list` names none;
- **checkouts**: each repository's branch and `git status --porcelain` are what they were before
  the lab started.

**Anti-game:** the verdict reads git and nothing else: never the lab's code, its run source's
answer or a hook's return value. A run that finds its repository any other way than through its
session lands where the control puts it.

**Model:** n/a. The server gets no model credential; the lead's board files the task, and the
scripted coder runs it.

**Run:** `cd goals && env -u FSDEV_DEFAULT_MODEL pnpm tsx claude-code-style-lab/works-in-its-repository/run.mts`
(about 20 seconds).

**Control:** `GOAL_CONTROL=first-repository`: the lab's run source answers the first registered
repository, whatever the session's (`fsdev.config.mts` reads it). Must FAIL on *second* and
*first*: the run's worktree is in the first repository.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-15 | main + this goal (bdb09e37, lab host unchanged) | n/a, scripted coder | FAIL | the lab declares no session repository: the open's `setSessionFields` answers 500 |
| 2026-11-15 | FIX-2628 PR 2 | n/a, scripted coder | PASS | one worktree, `data/runs/round-invoice-totals-…`, in `billing-web`'s list; none in `ledger-api`'s; both checkouts unchanged |
| 2026-11-15 | FIX-2628 PR 2 | n/a, scripted coder | FAIL (control `first-repository`) | the run's worktree is in `ledger-api`'s list, none in `billing-web`'s |
