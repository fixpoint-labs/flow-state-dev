---
"@flow-state-dev/engine": minor
---

Isolated user and org state now belongs to the flow instance that wrote it, not to its kind (FIX-1323). Two registered copies of one `collection` definition keep separate private scope state and separate `flowIsolation: true` resources; a singleton's keys are unchanged, because its instance id is its kind. The exported scope-key helpers (`resolveUserStorageKey`, `resolveOrgStorageKey`, `resolveResourceScopeId`, `resourceScopeIds`) take the instance-bearing shape `{ id, ... }` in place of `{ kind, ... }`. An existing collection deployment with isolated data attributes it through the offline cutover documented in Persistence → Who owns a record.
