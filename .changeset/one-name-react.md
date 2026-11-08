---
"@flow-state-dev/react": minor
"@flow-state-dev/testing": minor
"@flow-state-dev/vercel": patch
---

**Breaking:** package scaffolding leaves the roots, and names another package declares are re-exported, not copied (FIX-2449). No deprecated aliases.

- **react:** `reactPackageMarker`, `coreItemImportProof`, `CoreItemImportProof` and `CoreTypeImportProof` are removed. `RosterWorker` is no longer exported from `@flow-state-dev/react/workforce`; workforce's type of that name is unchanged. `FlowCardinality` is now core's type, re-exported, with the same two values.
- **testing:** `testingPackageMarker` is removed.
- **vercel:** `FlowApiRouter` is now engine's type, re-exported; its shape is unchanged.
