---
"@flow-state-dev/core": minor
"@flow-state-dev/server": patch
---

Add `ResourceRef.getOrPatchState(key, compute)` — get-or-compute over a single resource's state. Reads `state[key]`; on a miss runs `compute`, patches the result under `key`, and returns it. The callback runs only when the key is absent, so an expensive fetch/compute happens at most once per stored key for the resource's lifetime, and later readers get the same stored copy without re-deriving it. A present value (including `null`) is a hit; a `compute` resolving to `undefined` stores nothing. No time-based freshness — this is a per-resource (e.g. per-session) data spine, not a cache; concurrent misses on the same key each run `compute`, so call sites that must coalesce an upstream fetch should still dedupe there. `applyGetOrPatchState(ref, key, compute)` is exported for builders/tests.
