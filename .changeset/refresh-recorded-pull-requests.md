---
"@flow-state-dev/harness-manager": patch
---

A run's recorded pull requests can be read again from GitHub. The coding worker flow gains a `refreshPullRequests` action that reads every pull request a run session records as not yet merged or closed through the host's `gh` and writes each one's state back. A page calls it through `refreshSessionPullRequests(client, runSessionId)` from `@flow-state-dev/harness-manager/browser`, which returns the rows as `readSessionPullRequests` does. Before, the record was written only by the run and by its task's wait on the pull request, so a pull request merged or closed after its task ended kept reading `open`. One GitHub can't answer for keeps its last state (FIX-2990).
