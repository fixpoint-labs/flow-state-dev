---
"@flow-state-dev/engine": patch
---

Client streams no longer carry `item.updated` patches for items a client can't see, so a hidden item's data, such as a `block_trace`'s block output, stays off the end-user stream. A patch now passes only for an item the stream has already sent as client-visible, whether the update names it by `itemId` or by the legacy `id`. A patch for an item the stream never sent is dropped, for example on a stream resumed after that item's `item.added`. The item's `item.done` still delivers its final state. `?include=trace` streams are unchanged (FIX-1565).
