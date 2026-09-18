---
"@flow-state-dev/harness-manager": minor
---

A phase's `isDone` is handed how the run said it stopped. Its parameter is now `CompletionRunContext`, which adds `stopReport` — the harness's own `finished` / `stopped-at-limit` / `failed` word, passed through as reported, `null` when no terminal result arrived. A check that ignores it behaves exactly as before, including settling a row whose run ran out of budget after committing part of the work (FIX-1438).
