---
"@flow-state-dev/engine": patch
"@flow-state-dev/core": patch
---

A wide fan-out of concurrent request-state writes inside one run now commits every write instead of failing with `ConcurrentModificationError`. (FIX-1155)
