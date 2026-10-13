---
"@flow-state-dev/codex": patch
---

A resume Codex refuses because it no longer has the thread now fails with a `CodexAgentRunError` whose `harnessFailure` is `"unknown-conversation"`, so `harnessFailureKind(error)` from `@flow-state-dev/core` tells it apart from every other failure without matching Codex's message. Only Codex's own `no rollout found` error for the thread the run asked for is classified; a sign-in error, a process that never started, or any failure after Codex names a thread reads `null`.
