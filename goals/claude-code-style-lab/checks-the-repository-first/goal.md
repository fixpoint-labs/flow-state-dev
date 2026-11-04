# claude-code-style-lab › it checks the repository first

**Issue:** FIX-2403 (epic FIX-2369), leg a

**Outcome:** A person making a project in the Claude Code-style lab learns before pressing Create
that its repository won't work and why: a folder that is not a git repository, or a repository
whose `.gitignore` doesn't ignore `.fsdev/`. The server refuses the same project in the same
words, so a client that skips the page can't make it either. A repository the lab can use is
made, and the picker says what happens to it.

**Input:** `fixtures/input.json`: three project names. The run makes the three folders in a temp
directory, under names no lab file holds: a plain folder, a git repository with no ignore rule,
and a repository made by `lab.mts`'s `makeRepository` (which ignores `.fsdev/`). Any other names
and folders pass a correct lab.

**Signal:** one browser on `fsdev dev --config labs/claude-code-style/fsdev.config.mts --app
@flow-state-dev/claude-code-style`, a fresh data folder, `CLAUDE_CODE_STYLE_HARNESS=stub`, the
second and third folders listed in `CLAUDE_CODE_STYLE_REPOSITORIES`.

- **refused**: `createProject` through the public client on the first two folders fails with
  `repository-unusable`, and `listProjects` holds neither.
- **same-words**: in the picker, leaving the Repository field shows the problem (`is not a git
  repository`; `**/.fsdev/`) and Create stays off.
- **made**: the third folder's project is made, and the line under the field says its runs work
  in worktrees.

**Anti-game:** **refused** grades the server's own refusal and project list, read with the public
client, never the adapter or the page. The refusal text is floored with `tell.over`, so an empty
read is CAN'T TELL.

**Model:** n/a. No model credential reaches the server.

**Run:** `pnpm tsx goals/claude-code-style-lab/checks-the-repository-first/run.mts`

**Controls:**
- `GOAL_CONTROL=no-repository-check`: the lab's projects flow built with no repository check
  (`fsdev.config.mts` reads it). Must FAIL **refused**: both projects are made and listed. The
  page's legs fail with it, since the picker has no check to ask.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-04 | a7e6f2d1 tree, pre-commit | n/a | FAIL (control `no-repository-check`) | refused: `listProjects` held `loose-files` and `bare-checkout`, both made; the picker showed nothing and Create made nothing |
| 2026-11-04 | a7e6f2d1 tree, pre-commit | n/a | PASS | both refused `repository-unusable`, neither listed; each problem shown in the picker with Create off; the listed repository made, the picker saying its runs work in worktrees |
