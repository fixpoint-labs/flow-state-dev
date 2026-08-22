---
"@flow-state-dev/patterns": patch
---

`eventActors`' two state-only steps — the initial task spawn and the re-emission tap — no longer echo their input onto their `block_trace` items. Those traces now carry no output value, where they previously duplicated the value of the item feeding them. What `eventActors.emit` returns is unchanged (FIX-1214).
