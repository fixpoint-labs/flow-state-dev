---
"@flow-state-dev/orchestration": patch
---

A task's ending reaches the session that filed it once, on the defaults too: a `getTask({ id, wait: true })` that reads a task already ended no longer races that task's `onTaskSettled`. A notice now waits while the request that filed its task is running (not while it is parked on a person or a wait), and that request sends it as it parks or ends. `taskSettledEntry` takes a notice in one conditional write before it runs your block, and a copy never takes a notice from a request that hasn't ended. A wait that finds the notice taken returns `{ ok: true, taskId, arrivesAsNotice: true, message }` instead of the task. Task collection refs gain an optional `takeNotice(id, notice, take)`, which both built-in backings implement; a ref without it admits notices as before. A filing's `metadata` can no longer carry notice records (FIX-2123).
