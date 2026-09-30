---
"@flow-state-dev/engine": patch
---

A `response` that exposes only `emit()` now receives `item.updated` events keyed by `itemId`, like every other stream, instead of `id`.
