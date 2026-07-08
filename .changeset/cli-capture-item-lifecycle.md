---
"@flow-state-dev/cli": patch
---

`fsdev run --capture` (and the stdout NDJSON stream) now includes `item_updated` and `item_done` events, so patches applied after an item is added — like a trace's `modelUsage` — are visible in the captured run.
