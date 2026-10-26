---
"@flow-state-dev/orchestration": patch
---

A task board's drain now returns while one of its rows waits on an unanswered question. A worker that calls `askMidway` ends its turn and drops its lease, so no worker is on that row any more; the drain used to keep waiting for one anyway, and an inline board hung until the person answered or the drain ran out of iterations. Now, once nothing else is claimable, the drain returns and leaves the row held. The answer owes the row its next turn on the same attempt, and the next drain (for example, the one that runs after the answer) claims that turn and settles the task (FIX-2210).
