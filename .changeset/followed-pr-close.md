---
"@flow-state-dev/workforce": patch
---

A pull request followed with `followPullRequest` now reaches the session that follows it when it merges or closes, on push and on poll, whoever merged it, and past the follow's event filter, screens and hourly cap. Then the subscription ends, as before. A coding task waiting on its pull request wakes on the merge instead of staying open. Routines are unchanged: a close still ends them unheard unless their event filter and screens pass it (FIX-2784).

Docs: packages/workforce/README.md (`followPullRequest`: the close reaches the session), apps/docs/docs/workforce/messaging-workers.md (when a subscription hears the close of what it follows).
