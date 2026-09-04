---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

Retention's `maxItems` check now counts items through a new required `RequestStore.countItems(requestId)` contract method instead of loading every item of every completed request in the session. Custom `RequestStore` implementations must add `countItems`; it returns what `get(id)` would surface as `items.length`, including the legacy blob/table dual-read union.

Implement `RequestStore.countItems` with an indexed COUNT on `request_items`, so retention sweeps no longer materialize item payloads.
