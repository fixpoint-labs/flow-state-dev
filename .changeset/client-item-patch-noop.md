---
"@flow-state-dev/client": patch
---

`RequestStreamStore.applyItemPatch` now returns false when patch values are unchanged, avoiding phantom React flushes on redundant `item.updated` events.
