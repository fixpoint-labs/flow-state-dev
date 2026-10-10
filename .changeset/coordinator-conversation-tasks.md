---
"@flow-state-dev/workforce": minor
---

A coordinator conversation keeps its own task board, worked through Orchestration's task tools on the coordinator's turn and as `addTask_tasks`-style actions, for the conversation's delegates that take tasks; each task runs in a new task session of the user's, found with `findWorkerSession({ worker, taskId, filingSessionId })`, and the conversation hears once how it ended (FIX-1794).
