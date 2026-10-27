---
"@flow-state-dev/engine": minor
---

`ctx.request.tokenUsage` now counts every model call in production too, so an action's `tokenBudget` warns, marks the request incomplete, or fails it there as it does in development (FIX-2145). A request that suspends and resumes keeps one count across both runs.
