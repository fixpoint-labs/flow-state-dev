---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

On a Workforce conversation's board, a task runs one turn at a time in its session: while one of its turns waits on a step it filed for itself in a session of its own, a notice's turn and a steer's turn wait until it answers, instead of planning beside it and stalling the task. `taskSettledEntry` takes `defer`, and `resendNowPatch` is exported (FIX-2113).
