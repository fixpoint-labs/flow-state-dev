---
"@flow-state-dev/engine": patch
---

Cross-flow resource schema validation now runs again. Registering two flows that declare a user- or org-scoped resource at the same `ref` with incompatible `stateSchema` throws `CrossFlowSchemaConflictError`, as the storage docs describe — previously the check read a resource map that no longer exists and silently passed, letting two flows share one durable cell with disagreeing shapes.

Resources are compared by `(scope, ref, effective flowIsolation)` rather than by the accessor name they hang off `ctx.resources.<key>`, and each resource's isolation is resolved independently of the flow-level `isolateUserState` / `isolateOrgState` flag — so a resource that opts out of flow isolation is still checked, and one that opts in is left alone.

Two overlaps are still undetected and are called out in the storage docs: a collection pattern overlapping a concrete ref, and two instances of one flow kind whose `resources` overrides disagree.
