---
"@flow-state-dev/patterns": minor
---

Remove unsupported `onSubTaskError: "retry"` from the `SubTaskErrorStrategy` type. This is a type-level change only — `parallelTasks` and `supervisor` still warn and coerce `"retry"` to `"skip"` at runtime, so an untyped caller that reaches them with it keeps getting a warning instead of a silent no-op. Use `"skip"` or `"fail"`; on `supervisor`, bound review-driven retries with `maxAttemptsPerTask` (FIX-1210).
