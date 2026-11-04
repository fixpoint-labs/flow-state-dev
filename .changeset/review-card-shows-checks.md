---
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/shift-manager": patch
---

A coding run's review card shows the project's checks the run passed or failed (FIX-2387).

- **harness-manager:** `reviewDetail` (browser entry) also reads the review stop's `checks` into `ReviewDetail.checks`, `null` when the phase ran none; `ReviewCheck` is exported beside it. **Breaking for code that builds a `ReviewDetail` by hand:** add `checks: null`.
- **shift-manager:** the review card in a task's thread shows "Checks n/m passed", open on a red check's output.
