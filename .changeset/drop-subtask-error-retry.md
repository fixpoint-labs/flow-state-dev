---
"@flow-state-dev/patterns": minor
---

Remove unsupported `onSubTaskError: "retry"` from the `SubTaskErrorStrategy` type. Both `parallelTasks` and `supervisor` already warned and coerced it to `"skip"`. Use `"skip"` or `"fail"`; on `supervisor`, bound review-driven retries with `maxAttemptsPerTask` (FIX-1210).
