---
"@flow-state-dev/core": minor
---

Remove unused `generator().loop.stopWhen` and `tools.defaults.concurrency`. Bound the generator loop with `maxIterations`; tool defaults still honor `timeoutMs` and `retry` (FIX-1210).
