---
"@flow-state-dev/engine": minor
---

`createFlowState` now forwards `resolvePrincipal`, `staleSweepIntervalMs`, and `staleSweepThresholdMs` to the underlying router, so the host-level auth fallback and stale-request sweeper can be configured without dropping to `createFlowApiRouter`. The server docs for MCP, scheduled actions, authentication, and connection resilience now show the canonical `createFlowState` setup.
