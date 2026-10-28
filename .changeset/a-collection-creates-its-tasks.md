---
"@flow-state-dev/orchestration": minor
---

The task collection files a task under the filer tool's name (FIX-2243). `TaskCollection.addTask` and `addTasks` are `createTask` and `createTasks`, and a board capability's `ctx.cap.<board>.addTask` and `addTasks` are `createTask` and `createTasks`, so the method and the model's `createTask` tool take one `TaskInit` under one name. The rename is breaking, with no alias.
