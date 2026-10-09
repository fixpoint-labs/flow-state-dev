---
"@flow-state-dev/engine": patch
---

`FlowState.dispose()` now stops the router it built (its stale-request and durability sweepers and adapter stop hooks) before closing the stores, so shutting down against a real store no longer logs `stale-request sweeper iteration failed`. `StaleRequestSweeper.dispose()` now returns a promise that resolves once a sweep already running has finished (FIX-1516).
