---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

`RequestWaits` gains an optional `running(requestIds)`: whether each request of the running session is running its own work now (`in_progress`), as opposed to parked (`suspended`) or ended. The engine's request host implements it (FIX-2123).
