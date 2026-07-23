---
"@flow-state-dev/engine": minor
---

**Breaking:** Removed the public middleware surface from `@flow-state-dev/engine`. The `middleware` option is gone from `createFlowApiRouter` and `createFlowState`, and `composeMiddleware` / `mergeMiddlewareStacks` / the `Middleware*` types are no longer re-exported from the package root. The composition seam is now engine-internal: `Middleware` types live in `packages/engine/src/middleware/types.ts`, and a middleware stack is fed only through the internal `RuntimeConfig.middleware` path (`runAction` → `executeBlock`). No production code registers middleware today; the seam is kept for framework-owned instrumentation and a future designed public contract. See `docs/architecture/internal-execution-seams.md`.
