---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/devtool": patch
---

Trace per-block resource loads for DevTool observability. Each block's `block_trace` now carries `resourceLoads` (and `declaredResources`): the resource loads attributable to that block — store fetch vs in-memory cache hit, wall time, the prefetch wave or accessor that triggered it — so authors can see what a collection's `prefetchMode` actually costs instead of tuning it blind. Recording is concurrency-safe and gated by trace observability, so it adds no runtime cost when off, and the SSE items stream is untouched.

`@flow-state-dev/core` exports the new `ResourceLoadRecord` type and adds `resourceLoads`/`declaredResources` to `BlockTraceItem`. `@flow-state-dev/engine` records loads across the three prefetch waves, the lazy on-demand path, and collection accessor reads. The DevTool block detail panel adds a "Resource Loads" section (declared vs loaded, per-load source/timing/cache-hit) and a request-level "Resource Load Summary" (total loads, fetch time, slowest fetch, cache-hit rate).
