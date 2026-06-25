---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

Decouple `.work()` background task lifetime from the request's transport-level abort signal. Background generators now survive transport teardown (client disconnect, SSE close, tab refresh) and abort only when the request is explicitly cancelled via the `/abort` endpoint or `session.abortRequest()`. This fixes background generators in Event Actors flows failing simultaneously with `"Invalid error response format: Gateway request failed: This operation was aborted"`. The same substitution applies to `.workIf()` and `.forEachBackground()` — their per-iteration abort check now breaks only on explicit cancellation. The AI Gateway abort error is also unwrapped (the original error is preserved as `cause`) so background failures surface a legible message instead of doubly-wrapped gateway noise. New `rootCause(err)` and `isAbortLike(err)` helpers are exported from `@flow-state-dev/core`. Flows that relied on client disconnect stopping background work should set a per-block timeout instead.
