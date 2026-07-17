---
"@flow-state-dev/client": patch
---

`RequestStreamStore.loadSnapshot` now sorts items by `ts` and `itemIndex` so callers (e.g. DevTool continue-request) get correct chronological order even when the input array is unsorted.
