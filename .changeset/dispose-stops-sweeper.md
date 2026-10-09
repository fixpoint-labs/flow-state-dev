---
"@flow-state-dev/engine": minor
---

Shutting a `FlowState` down against a real store no longer logs a spurious stale-request sweeper failure, and `StaleRequestSweeper.dispose()` now returns a promise that settles once any running sweep finishes (FIX-1516).
