---
"@flow-state-dev/orchestration": patch
---

An inline task-board drain returns while a row waits on an unanswered question, and leaves that row held. The next drain, after the answer, claims the owed turn on the same attempt (FIX-2210).
A `goalSeekLoop` whose drain leaves a task waiting on an answer judges nothing: it ends that pass with `reason: "waiting-on-a-person"`, runs no `finalize` and spends no iteration. If the answer lands just as a drain stops, the loop drains again for the turn it owes before judging, and that drain spends no iteration.
