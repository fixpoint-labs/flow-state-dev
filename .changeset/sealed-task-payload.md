---
"@flow-state-dev/orchestration": minor
---

A task row can carry `sealed`, a payload written once by the code that files it and packed to its worker as `TaskWorkerInput.sealed`; no task tool or update can set or change it, and `TaskFilter.sealed` matches on its plain values. (FIX-1872)
