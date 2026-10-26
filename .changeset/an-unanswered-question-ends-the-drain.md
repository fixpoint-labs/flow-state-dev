---
"@flow-state-dev/orchestration": patch
---

An inline task-board drain returns while a row waits on an unanswered question, and leaves that row held. The next drain, after the answer, claims the owed turn on the same attempt (FIX-2210).
