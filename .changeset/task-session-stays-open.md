---
"@flow-state-dev/workforce": minor
---

A task's session stays open until the task is done and after: a worker parks on a question with `parkOnQuestion`, the conversation answers with `answerTask_tasks`, and a follow-up filed with `followUpOf` runs in the same session (FIX-1817).
