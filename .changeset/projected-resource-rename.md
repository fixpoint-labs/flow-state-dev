---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
---

Rename the read-through collection family from `ExternalResource*` to `ProjectedResource*` (FIX-1518). Call `defineProjectedResourceCollection` and the `projected: true` brand; the old `External*` names and `external: true` brand are gone.
