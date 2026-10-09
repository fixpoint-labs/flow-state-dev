---
"@flow-state-dev/orchestration": minor
---

A task row can be an ask (`Task.ask`: the gate its asking turn parks on, and a deadline). The write that ends an asked row also sets `Task.resumeOwed`, on both built-in backings; `TaskFilter.resumeOwed` matches those rows, and the optional `TaskCollectionRef.clearResumeOwed` clears the marker (change kind `resume_settled`). Rows that are not asks are unchanged (FIX-1816).
