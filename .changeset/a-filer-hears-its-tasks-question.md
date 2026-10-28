---
"@flow-state-dev/orchestration": patch
---

A task list's `delivery` can declare `onMidwayQuestion(ctx, row, holds)`: after a worker asks a question midway (`askQuestion`, `askMidway`, or a coding run's question), the board calls it from the request that asked, with the row and its open midway questions, read from the stored row, so the task's filer can be told. A replayed turn calls it again with the same questions. Task collection refs gain an optional `tellMidwayQuestions(row)`, which the resource backing implements when the declaration has the hook (FIX-2241).
