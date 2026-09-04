---
"@flow-state-dev/orchestration": patch
---

Task Board workers that declare `taskWorkerInputSchema` now receive the `priorWork` the board's flow policy selected instead of having it stripped by the schema (FIX-1288).
