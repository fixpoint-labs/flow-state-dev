---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

`RequestWaits` gains an optional `running(requestIds)`: whether each request of the running session is running its own work now (`in_progress`), as opposed to parked (`suspended`) or ended. The engine's request host implements it. A host that supplies its own `RequestWaits` should add `running` too: without it, a task board doesn't hold a task's notice while the request that filed the task runs (FIX-2123).
