---
"@flow-state-dev/shift-manager": patch
---

A coordinator reply the coordinator answered itself no longer carries a "routed · by the coordinator · the coordinator handed it to no delegate" note. The note still shows when the reply went to a worker, or when a worker was tried and missed (FIX-2488).
