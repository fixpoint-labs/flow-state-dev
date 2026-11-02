---
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/claude-code": patch
"@flow-state-dev/react": patch
---

`harnessManager({ approveTools: true })` makes a run's tool call that isn't pre-allowed wait for a person's approval as the task's hold, then resumes the same coding session on Allow, Allow for this run, or Deny; claude-code's `onToolApproval` gains a `held` decision, and react's `useApproval` gains `approveWith`, `rejectWith` and `approveOptionsOf` (FIX-2389).
