---
"@flow-state-dev/claude-code": patch
---

The `observed-plan` names exported from `@flow-state-dev/claude-code/sdk` are now re-exports of `@flow-state-dev/core`'s, the same objects, and plan entries stream to an open page as they change. With `recordWork`, the agent also declares `observed-plan-list` and marks a run's plan `incomplete` there when a plan entry fails to write. A run that fails because Claude Code doesn't know the conversation it was asked to resume now throws a `ClaudeAgentRunError` with `harnessFailure: "unknown-conversation"`, which `harnessFailureKind` from `@flow-state-dev/core` reads (FIX-1915).
