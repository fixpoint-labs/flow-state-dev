---
"@flow-state-dev/engine": patch
---

A long-running request no longer holds every transient item it has emitted in memory (FIX-2672). The response emitter keeps every durable item and every in-progress transient item, but only the newest `maxBufferSize` (default 10,000) done transient items, such as `resource_change`, transient `block_trace` and `state_snapshot`. Their `item.added` / `item.done` events still reach clients and the events log, and `itemIndex` values never repeat.

- `response.getItems()` and the entry check of `.waitForCondition` (and so `whenResourceChanged` / `whenResourceMatching`) see only those newest done transient items. A request that emits fewer than 10,000 of them sees no difference.

Docs: none needed beyond the JSDoc on `ResponseEmitterHandle.getItems()`, `.waitForCondition` and the resource-change predicates.
