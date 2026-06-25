---
"@flow-state-dev/engine": minor
"@flow-state-dev/core": patch
---

User/org resource `flowIsolation` is now honored per resource instead of collapsing to a flow-wide decision.

A resource declared `flowIsolation: false` keys at the bare `{userId}` (or `{orgId}`) and stays shared across flows even when a sibling resource on the same flow declares `flowIsolation: true` — which keys at `{userId}:{flowKind}`. Previously any single isolated resource forced every user/org-scoped resource on the flow into the namespaced bucket, so `flowIsolation: false` could not opt a resource out of a sibling's isolation. The flow-level `isolateUserState` / `isolateOrgState` flag now keys only the scope's own `state` record and acts as the default for resources that don't declare their own isolation.
