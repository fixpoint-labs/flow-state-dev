---
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/ui": patch
---

A coding run's review says what was asked, what the run says it did, where to look, and the judge's whole reason (FIX-2782).

- **harness-manager:** the review stop's `data` carries `goal`, `answer` (the run's final message) and `pullRequests` (each `{ url, number }` open on the run's branch). `reviewDetail` reads those and the changed `files`, `fileCount`, `added` and `removed`, which the stop already carried, into `ReviewDetail` (new `ReviewFile` and `ReviewPullRequest` types).
- **ui:** the `review-hold` card shows the ask, the run's summary, a link to each open pull request, the changed files with their lines (each linking to the pull request's diff when there is one), and the judge's reason in full instead of three lines.

Docs: none (the registry card's props are documented in its source; no user docs page lists the review card's fields).
