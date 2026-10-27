---
"@flow-state-dev/harness-manager": patch
---

`harnessTalkTurn` is the session door's talk half as its own block: it resumes a finished task's coding session with a message and returns `{ reply, taskId }`, refusing a task that is still running (FIX-2160).
