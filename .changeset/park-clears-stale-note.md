---
"@flow-state-dev/orchestration": patch
---

`awaitReview` with no reason now clears the task's `feedback` instead of leaving the previous note in place, so a failed attempt's error text no longer reads as the reason a parked task is waiting (FIX-1505).
