/**
 * Shared tool-fetch cache for the trading-desk flows.
 *
 * Replaces the former hand-rolled process-global TTL map
 * (`analysis/tools/runtime/cache.ts`) with the framework's cached-fetch
 * capability. Data tools list `analysisCache` in their `uses` and call
 * `ctx.cap.cache.getOrFetch(tool, args, fetcher)` — same input-addressed
 * key shape as before, now riding a persisted, user-scoped resource
 * collection shared across the analysis and portfolio flows.
 *
 * Scope note: the cache is `user`-scoped with `flowIsolation: false`, so
 * entries persist per user across sessions and across both flows (the old
 * map was process-global cross-user; this is the safe multi-tenant default).
 * Concurrent runs for the same user still share one upstream fetch via the
 * capability's cross-request single-flight (`processDedup`, on by default).
 *
 * Unbounded + lazy: tool payloads can be large, so the collection is not
 * count-bounded (omitting `maxInstances` defaults to lazy prefetch — no
 * per-request bulk load). The 120s window matches the former `TTL_MS`.
 */
import { createCachedFetchCapability } from "@flow-state-dev/patterns";

/** The trading-desk tool-fetch cache. Exposed on consuming blocks as `ctx.cap.cache`. */
export const analysisCache = createCachedFetchCapability({
  name: "cache",
  pattern: "toolCache/**",
  scope: "user",
  flowIsolation: false,
  staleAfter: 120_000,
  // The old process cache never served stale-on-error: a miss ran the fetcher
  // and propagated its result (or throw). The desk relies on that — providers
  // throw on failure and tools degrade to empty/null rather than reuse old
  // data, and the post-Phase-1 taps (compute-spine, store-price-history) pass a
  // fetcher that throws ON PURPOSE to mean "not warm this run". Serving a stale
  // entry there would build the spine/price-history from a prior run. Keep the
  // old semantics: never serve stale on a fetcher error.
  staleIfError: false,
});
