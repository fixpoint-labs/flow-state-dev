---
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/shift-manager": patch
---

A coding run's review now carries what the user decides on: what was asked, the run's own summary, this round's commits and where the pull request is (FIX-2782).

- **harness-manager:** the `kind: "review"` stop's data gains `goal` (the task's goal), `answer` (the run's final message), `pullRequests` (the task's recorded pull requests and the one open from its branch, each `{ number, url }`) and `round` (`{ commits, subjects }` for this round's commits when the branch already had commits before it; `null` when the round is the whole branch). The stop's prompt names the same four things. `reviewDetail` reads the new fields, plus the `files`, `fileCount`, `added` and `removed` the stop already carried, and reads each as `null` (or `[]`) on a stop recorded before them. New exported types: `ReviewPullRequest`, `ReviewFile`.
- **shift-manager:** the Inbox review card shows the ask and the run's summary as Markdown, this round's commits apart from the branch's earlier ones, a link to each pull request, the changed files folded under their totals, and the judge's whole reason instead of three clamped lines.

Docs: packages/harness-manager/README.md (the `reviewChanges` section: the review's data and prompt name the ask, the run's summary, this round's commits and the pull requests)
