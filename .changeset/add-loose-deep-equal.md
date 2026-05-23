---
"@flow-state-dev/core": patch
---

Add `looseDeepEqual` to `@flow-state-dev/core/helpers`: a lenient structural-equality comparator for UI-side memoization that never throws on exotic shapes (Map, Set, Date, functions). It complements the existing strict `deepEqual`, which fail-fasts on non-JSON-shaped values for the state-write no-op guard. The DevTool's session-context and resource-state views now use this shared helper instead of a local copy.
