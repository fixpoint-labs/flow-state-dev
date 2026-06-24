---
"@flow-state-dev/engine": patch
---

Retried requests now honor the same instance-level `settings`, tracing level, and background-work hook as the original dispatch, instead of running without them.
