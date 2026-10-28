---
"@flow-state-dev/orchestration": patch
---

A plan board's drain that fails after handing a row to a session of its own now fails its request, naming the row, whatever `onError` says, instead of waiting with no signal (FIX-2104).
