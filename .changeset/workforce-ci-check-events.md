---
"@flow-state-dev/workforce": patch
---

CI reaches a coding run. A run's pull-request follow (`githubTrustedReviewers().follow`) now hears a failed check on that pull request whoever ran it (GitHub Actions, Vercel, any app), without listing the app as a trusted reviewer. A check that passed, was skipped, neutral or cancelled isn't delivered. Comments and reviews still need a listed sender: `github-actions[bot]` is never a trusted reviewer and never needs listing.

A GitHub `check` event now carries only what GitHub sets: title `Check <name>: <conclusion>`, text lines `status: completed`, `conclusion: <conclusion>` and `head: <sha>`, and the check run's link. The run's `output` (title, summary, text, annotations) is no longer in the event's text, for any subscriber, because the workflow writes it.

Docs: apps/docs/docs/build/webhooks/github-reviews.md (drop "To hear GitHub Actions, list `github-actions[bot]`"; say a failed check reaches the run whoever ran it, as name, outcome, commit and link, and a passing one doesn't)
