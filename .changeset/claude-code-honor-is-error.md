---
"@flow-state-dev/claude-code": patch
---

`claudeCodeAgent` now reports a failed run when the Agent SDK ends a turn with a `success` result flagged `is_error` (how the SDK reports an API error). The handle's `status` is `"errored"` and its `outcome` is `"failed"`, and an `error` item carries the SDK's error text; previously the run was recorded as completed (FIX-1175).
