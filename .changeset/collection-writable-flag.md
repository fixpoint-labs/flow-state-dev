---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

`defineResourceCollection` now accepts `writable: false`, and an instance write on that collection throws instead of silently succeeding (FIX-1261).
