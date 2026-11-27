---
"@flow-state-dev/harness-manager": minor
---

A run's commits come with their log, and a git read in a run's checkout runs none of the checkout's commands.

- **A commit log beside the subjects.** `readRunCommits(cwd, base, cut, { log: true })` adds `log`: each commit newest first as `{ sha, subject, author, at, merge }` (`RunCommitEntry`, `runCommitEntrySchema`). The run changes view's `commits` and the stored review data (`ReviewDetail.log`, `round.log`, as `ReviewCommit`) carry it. A review stored before this reads `log: null`; fall back to `subjects`.
- **No command from the checkout runs on a read.** A coding run can write its checkout's git config and `.gitattributes`. Every read harness-manager makes there (the diff, each file's patch, the working-tree reads, the commit log) now switches off fsmonitor hooks, external diffs, diff drivers and textconv, clean/smudge/process filters and signature checks, ignores system and global git config, and passes `--no-ext-diff --no-textconv` to every diff and log. Before, opening a run's changes could run a command the run had named, in the server process.

Docs: packages/harness-manager/README.md and apps/docs/docs/orchestration/harness-manager.md (`log` on `readRunCommits`, the view's `commits` and the review data; the note that reads in a run's checkout run no checkout-named command)
