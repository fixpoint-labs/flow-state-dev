---
"@flow-state-dev/core": minor
---

**Breaking:** Removed the public middleware surface from `@flow-state-dev/core`. The `Middleware`, `MiddlewareFn`, and `MiddlewareContext` type exports are gone, and the `middleware` option no longer exists on `defineFlow` or on the `handler` / `generator` / `router` block builders. Block middleware was a prematurely-shipped extension point with zero consumers; the composition seam it fed is retained internally in `@flow-state-dev/engine`. For cross-cutting behavior use action lifecycle hooks (`onCompleted` / `onErrored`), `.tap()` on sequencers, capabilities, a structured `logger`, or the trace system. See `docs/architecture/internal-execution-seams.md`.
