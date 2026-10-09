---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

An ask gate can carry a deadline (`parkOnAsk({ deadline })`). The durability sweeper resumes a gate still pending past it with `wait_timed_out` instead of marking it expired, so the parked turn ends with the error rather than waiting forever. `AskEndedError`'s message now leads with its code (FIX-1816).
