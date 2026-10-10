---
"@flow-state-dev/orchestration": minor
---

The task tools gain `answerTask` and `addTask`'s `followUpOf`, and `createParkOnQuestion` builds a worker's `parkOnQuestion`, so a task can stop on a question, take its answer without spending a retry, and be followed up in the same session (FIX-1817).
