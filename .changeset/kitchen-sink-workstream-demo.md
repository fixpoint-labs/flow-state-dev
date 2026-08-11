---
"@flow-state-dev/ui": patch
---

Fix duplicate React keys in the `request-group` registry component (FIX-1013).

`RequestGroupRenderer` keyed each segment on its `requestId`, which assumed a
request owns exactly one contiguous run of items. A keyed item breaks that: it
is one logical entity across every request that re-emits it, so it holds its
first position in the stream while its `requestId` moves to the latest emitter —
splitting the surrounding request into two segments with the same key. React
logged a duplicate-key error and was free to drop or duplicate a segment. Keys
now carry the segment's position as well.

Surfaced by the kitchen-sink's new background-work demo (`@flow-state-dev/kitchen-sink`
is private and ships no release note of its own): a durable task board reused
across turns re-emits its board-level snapshot every turn, which is exactly the
shape above.
