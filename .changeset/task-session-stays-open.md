---
"@flow-state-dev/workforce": minor
---

A task's session stays open until the task is done, and after. A worker on a task turn has `parkOnQuestion`, and the conversation answers with `answerTask_tasks` (or the coordinator's `answerTask` tool): the task picks up in the same task session with the answer as its next message, without spending a retry. The task as filed is now the task turn's user message, so the session's history holds it. A follow-up filed with `addTask`'s `followUpOf` runs in the finished task's session, with its worker, and is heard like any task (FIX-1817).
