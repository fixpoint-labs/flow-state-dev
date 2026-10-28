---
"@flow-state-dev/core": patch
---

A create call no longer records a pull request it only names (FIX-2307). `githubPullRequestRule` reads a `create_pull_request` result's `html_url` (else `url`), so a link in the new pull request's body, such as "Follow-up to …/pull/12", is not recorded as opened. A shell command whose only link-printing `gh` verb is `gh pr create` still records every link it prints. A command that also runs `gh pr view`, `gh api` or another verb that prints links now records nothing from that call, and the turn-end branch check finds a pull request it opened on the session's branch.
