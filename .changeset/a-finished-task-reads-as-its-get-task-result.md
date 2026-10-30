---
"@flow-state-dev/workforce": patch
"@flow-state-dev/orchestration": patch
---

A turn woken by a filed task's ending, and an answer again about tasks that finished mid-turn (`answerAgain`), now read each ending as a `getTask` call and its result for that task, the row in full, instead of a user-role message holding the line with its output cut at 500 characters. The line under the delegate's name is unchanged, and a turn of your own that isn't the built-in generator still gets it as its message. `finishedTasksAnswerAgain`'s default message now names each finished task (`- <taskId> (<worker>): <ending>`) without its result. Orchestration exports `readTaskView(task, rows)`, the read `getTask` returns (FIX-2345).
