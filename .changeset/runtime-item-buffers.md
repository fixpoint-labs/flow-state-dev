---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/contracts": patch
"@flow-state-dev/client": patch
"@flow-state-dev/testing": patch
"@flow-state-dev/orchestration": patch
---

The runtime's item buffers are now typed as `RuntimeItem`, which includes trace rows (`block_trace`, `router_decision`, `state_snapshot`), instead of the public `OutputItem` (FIX-2054). This is a type-only change: runtime behaviour is the same.

These signatures now return or pass `RuntimeItem`, which can break code that expects `OutputItem`:

- `ResponseEmitterHandle.getItems()` and the `subscribeToItems` listener and filter (core).
- `ResponseEmitter.getItems()`, `RequestRecord.items` and `RequestStore.persistItems` (engine).

`.waitForCondition` predicates and `wakeOn` filters keep their `OutputItem` types.

These signatures now also accept `RuntimeItem`: `resolveItemVisibility`, `collapseToCanonicalLog`, `RequestStreamStore.loadSnapshot`, `testItems`, and the filter that `onTaskChangeFor` returns.
