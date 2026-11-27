---
name: preview-mode
description: Work on several features at once, each in its own worktree with its own background worker, while the main session coordinates from a local-only preview branch that merges them all so the user can run everything together. Covers turning the mode on, dispatching a worker per feature, merging into and rebuilding the preview, and reclaiming worktrees once their work lands. Use when the user says "preview mode", "merge that into my preview", "rebuild the preview", "clean up worktrees", or wants isolated PR branches plus one place to try them all.
argument-hint: "[on | sync <branch> | rebuild | clean]"
---

# Mode: preview

**The main session is the coordinator.** It sits in the primary checkout on `preview/<user>`, a
branch that is never pushed, never PR'd and never a base. **Each feature is one background worker
in its own worktree**, on its own branch from `origin/main`; that branch is what becomes a PR. The
preview merges every live feature branch, so the user's one dev server shows them together.

This is the standing "background work, main coordinates" habit with a merge step added: the
coordinator dispatches and never does the work (`AGENTS.md`, and `docs/contributing/orchestration.md`
→ "The coordinator dispatches; it never does the work").

## How it sits next to the lifecycles

Preview mode changes no gate. An issue driven by `issue-lifecycle`, or a set driven by
`epic-lifecycle`, runs exactly as those skills say: their coordinator owns the worker, the branch,
the spec and merge gates, and the PR. The preview may *list* such a branch, so its work shows up in
the user's dev server, but it never commits to it, pushes it, or reclaims its worktree. Parallel
issue work still runs under an epic; the features a preview worker builds are ad-hoc ones
(`adhoc/<slug>`) unless the user hands over an issue branch.

## Turn on (once per clone)

1. `git config rerere.enabled true` and `git config rerere.autoupdate true`, so a conflict resolved
   once is replayed on every rebuild.
2. In the primary checkout: `git fetch origin main`, then
   `git switch --no-track -c preview/<user> origin/main`. `--no-track` gives it no upstream, so a
   plain `git pull` or `git push` never targets it, and `.husky/pre-push` refuses to push it.
   The primary checkout may carry uncommitted local edits that are meant to stay uncommitted.
   `git switch` carries them across as they are; never stash, commit or discard them, and never use
   `--hard` on the primary (see Rebuild).
3. Record each live feature branch: `git config --add preview.branch <branch>`. A rebuild merges this
   list, and `pnpm wt:prune` never removes a worktree on a listed branch.

## Coordinate

- Never edit feature code in the primary checkout. Changes, checks and commits happen in workers;
  the coordinator merges, rebuilds, cleans up and talks to the user.
- **New feature:** record its branch in `preview.branch`, then dispatch a background Agent with
  `isolation: "worktree"` (one per feature) whose prompt names the feature, its branch
  (`adhoc/<slug>`, or an issue branch the user handed over) and the task, and carries the worker
  rules below. Record first: until the worker commits, its branch sits at `origin/main` and would
  otherwise read as landed to `wt:prune`.
- **Follow-up on a feature:** `SendMessage` to that feature's existing worker, so its context and
  worktree carry over. Start a new worker only when that one is gone. Its old worktree still holds
  the branch, so remove it first (`git worktree remove <path>`, which refuses if anything there is
  uncommitted) and tell the new worker the branch already exists.
- Relay a worker's decisions to the user; workers never ask the user themselves. Push or open a PR
  only when the user asks, through that feature's worker.
- Each worktree holds a full checkout, and more once dependencies are installed. Size the number of
  parallel workers to the machine.

## Worker rules (put these in every dispatch)

- The harness creates your worktree under `.claude/worktrees/` off the coordinator's checkout, which
  is the preview branch: it carries every other feature. Move to your own branch before any work,
  as `docs/contributing/orchestration.md` → "Worktree branching" says (a new branch from fresh
  `origin/main`; an existing local branch with `git checkout <branch>`). Work only in this
  worktree; never touch the primary or another worktree.
- Load the skills and scoped context the task needs, as any session would.
- Commit locally once a unit of work passes its checks: the preview can only merge commits. Do not
  push or open a PR unless the coordinator says the user asked. Clear a conflict with `main` by
  merging `origin/main` in, never by rebasing.
- Return a compact status: worktree path, branch, new commits, check results, open decisions.

## Sync the preview

After a worker commits, merge its branch in the primary: `git merge --no-edit <branch>`. The
worktrees share one repository, so the worker's local commits are already visible here. A first
merge may fast-forward the preview onto the feature's tip; `.husky/pre-push` still lets that feature
push, because it refuses a preview tip only when the push would carry preview-only work. Resolve a
conflict between two features in the primary. If the feature itself is wrong, fix it through its
worker and merge again. A commit made on the preview by mistake goes to its feature branch through
that feature's worker (`git cherry-pick <sha>` there), then rebuild.

## Rebuild

Rebuild when `origin/main` has moved, a branch was reworked, or the user dropped a feature. In this
order:

1. Confirm the preview has no commits of its own, with the list as it stands, a branch being
   dropped included: `git log --no-merges preview/<user> --not origin/main $(git config --get-all
   preview.branch)` must print nothing. Run it before unsetting a dropped branch, or that branch's
   commits print and look like the preview's own.
2. Unset any dropped branch (Clean up, step 1).
3. `git fetch origin main`, then `git reset --keep FETCH_HEAD`, and merge each listed branch.

`FETCH_HEAD`, not the name `origin/main`: it is the commit this fetch just wrote, in this checkout,
while `origin/main` is shared with every worktree. `--keep`, not `--hard`: it moves the branch and
keeps the local edits, and it stops rather than overwrite one when `origin/main` changed the same
file. If it stops, tell the user which file; never fall back to `--hard`.

## Clean up

At every sync and rebuild, and when a feature's PR merges:

1. Drop a branch from the list only once its PR has merged or been closed, or the user drops the
   feature: `git config --unset preview.branch '^<branch>$'`. Never drop one whose worker is running.
2. `pnpm wt:prune` lists the agent worktrees whose work is already in `origin/main`;
   `pnpm wt:prune --yes` removes them and their branches. What it keeps, and why, is in
   `docs/contributing/orchestration.md` → "Reclaiming agent worktrees". For the preview, the rule
   that matters is that it never removes a worktree on a branch listed in `preview.branch`.
3. Report what was removed, the space freed, and what was kept and why. Removing a kept worktree
   needs the user's yes.
