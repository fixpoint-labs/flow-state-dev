---
"@flow-state-dev/workforce": patch
"@flow-state-dev/shift-manager": minor
---

A conversation board's browser read now carries each row's `spend`, the stored ledger of what its runs spent. Fold it with `taskRowView` for the row's harness, model, tokens and cost. Shift Manager draws it: the task inspector's *Harness · tokens · cost* section shows the spend line, and the Tasks COST column shows the vendor's charge, with no figure for a run billed by subscription (FIX-2398).
