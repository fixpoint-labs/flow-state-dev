---
"@flow-state-dev/server": minor
---

`createFlowState` handles now expose `getRuntime()`, which resolves the `{ registry, stores, runtimeConfig }` internals the router is built from. Off-transport consumers — background workers, queue processors, scripts — can now run from the same configuration as the HTTP server without reaching through the router.
