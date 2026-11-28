---
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/workspace": patch
---

A run's commits come with their log, and a git read in a run's checkout runs none of the checkout's commands (FIX-2983).

- **A commit log beside the subjects.** `readRunCommits(cwd, base, cut, { log: true })` adds `log`: each commit newest first as `{ sha, subject, author, at, merge }` (`RunCommitEntry`, `runCommitEntrySchema`). The run changes view's `commits` and the stored review data (`ReviewDetail.log`, `round.log`, as `ReviewCommit`) carry it. A review stored before this reads `log: null`; fall back to `subjects`.
- **No command from the checkout runs on a read.** A coding run can write its checkout's git config and attributes at any moment, and some git reads run a command named there. Every read harness-manager makes in a run's checkout (the diff, each file's patch, the working-tree reads, the commit log, and the coder flow's end-of-run check of whether a run changed files) now runs only commands that never read a working-tree file through git, with every diff and log under `--no-ext-diff --no-textconv`, fsmonitor, signature checks and transports switched off, and no system or global config. The working tree is read from disk, raw and never through a link, and its lines are counted in a scratch directory with no repository. Before, opening a run's changes, or a run ending, could run a command the run had named, in the server process.
- **Working-tree reads are bounded.** A file whose size differs from its blob's counts as changed unread; the rest are hashed up to 50,000 files, 512 MB and 8 seconds a read (kept between reads while a file is unchanged, so a large checkout is finished over the next polls). Past a limit, the changes view answers `verified: false`, and the coder flow's run-end check counts the run as having changed files, so its checks run. A file copied for its lines is read no further than 4 MB.
- **Working-tree reads count raw content.** A checkout that converts line endings on commit (`core.autocrlf`, an `eol` attribute) can read a file as changed where `git status` wouldn't.
- **workspace: `runBytes`.** `run`, with standard output as bytes, for output that isn't text (a blob's content). Same wall clock and environment allowlist as `run`.

Docs: packages/harness-manager/README.md and apps/docs/docs/orchestration/harness-manager.md (`log` on `readRunCommits`, the view's `commits` and the review data; the note that reads in a run's checkout run no checkout-named command); packages/workspace/README.md (`runBytes`)
