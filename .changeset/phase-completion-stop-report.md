---
"@flow-state-dev/harness-manager": minor
---

A phase's `isDone` is handed how the run said it stopped, as `CompletionRunContext.stopReport`, so a completion check can refuse to settle a row whose run ran out of budget partway (FIX-1438).
