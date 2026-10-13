---
"@flow-state-dev/codex": patch
---

A resume Codex refuses because it no longer has the thread now fails with a `CodexAgentRunError` whose `harnessFailure` is `"unknown-conversation"`, so `harnessFailureKind(error)` from `@flow-state-dev/core` tells it apart from other failures (FIX-1916).
