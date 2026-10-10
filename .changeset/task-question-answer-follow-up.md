---
"@flow-state-dev/orchestration": minor
---

The task tools gain `answerTask({ taskId, answer })` (and the `answerTask_<board>` action): it answers a task parked on its worker's question, re-queues it with the answer, which its next attempt reads as `input.answer`, and the claim that follows isn't charged against `maxAttempts` (counted in `turnReentries`). It declines a task that isn't parked on a question, one parked for a person's turn, and a finished one. `addTask` takes `followUpOf` to file new work on a finished task, refusing an `assignee` beside it, a task that hasn't finished, and a session with an unfinished task. `createParkOnQuestion({ resolve })` builds the worker's `parkOnQuestion({ question })` tool, which parks the row the running task turn holds, and the rule for offering it (not on a row filed with `waitForResponse`). `unpark` takes `{ answer: true }`, and `awaitReview` takes `{ fromRunning: true }`. Code that lists the task tools by name now sees nine (FIX-1817).
