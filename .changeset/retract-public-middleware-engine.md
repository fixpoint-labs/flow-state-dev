---
"@flow-state-dev/engine": minor
---

**Breaking:** Removed block middleware from `@flow-state-dev/engine` entirely. The `middleware` option is gone from `createFlowApiRouter` and `createFlowState`; the `Middleware*` types, `composeMiddleware`, `RuntimeConfig.middleware`, `ExecuteBlockOptions.middleware`, and the `executeBlock` composition wrap are all deleted. Block middleware had zero consumers, and the alternatives (lifecycle hooks, `.tap()`, capabilities, `block_trace`, `errorCapture`, and the internal `InternalExecutionSeams`) cover every real case. Framework-internal interception now lives solely in `InternalExecutionSeams`; if a framework-owned around-execution need arises later, reintroduce it as a narrow guardrail capability against that seam. See `docs/architecture/internal-execution-seams.md`.
