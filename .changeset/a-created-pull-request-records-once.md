---
"@flow-state-dev/core": patch
---

A create call now records the one pull request it opened (FIX-2307). `githubPullRequestRule` reads a `create_pull_request` result's `html_url` (else `url`), and the first link `gh pr create` prints. A link the new pull request's body names, such as "Follow-up to …/pull/12", is no longer recorded as opened.
