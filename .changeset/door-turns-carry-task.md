---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/workforce": patch
---

An action's optional `taskOf(input)` names the task a request is for, and the request's user message and items carry it as `taskId`; Workforce's built-in doors take an optional `taskId` through `doorTask`, and the inventory row says so as `doorTakesTask` (FIX-2422).
