---
"@flow-state-dev/patterns": minor
---

Remove unsupported `onSubTaskError: "retry"` from the `SubTaskErrorStrategy` type. Use `"skip"` or `"fail"`; bound retries with `maxAttemptsPerTask` (FIX-1210).
