---
"@flow-state-dev/patterns": minor
"@flow-state-dev/core": minor
---

Add the Cached Fetch surface: a freshness-bounded, identity-addressed cache over a resource collection, consumed as a capability (`createCachedFetchCapability`) with `getOrFetch` / `getOrCompute` / `invalidate`, plus the lower-level `cachedCollection`, `getOrCompute(ref, ...)`, and `invalidateCached` substrate for typed domain collections.

Add `parseDuration` to the public helpers (parses `"15m"`, `"120s"`, `"6h"`, or raw milliseconds) and build `ctx.cap` for nested blocks so capabilities resolve their accessors there.
