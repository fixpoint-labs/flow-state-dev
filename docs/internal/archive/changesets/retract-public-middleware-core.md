---
"@flow-state-dev/core": minor
---

**Breaking:** Removed block middleware from `@flow-state-dev/core`. The `Middleware`, `MiddlewareFn`, and `MiddlewareContext` type exports are gone, and the `middleware` option no longer exists on `defineFlow` or on the `handler` / `generator` / `router` block builders. Block middleware was a prematurely-shipped extension point with zero consumers; both the public surface and the internal composition seam it fed have been removed entirely. For cross-cutting behavior use action lifecycle hooks (`onCompleted` / `onErrored`), `.tap()` on sequencers, capabilities, a structured `logger`, or the trace system. See `docs/architecture/internal-execution-seams.md`.
