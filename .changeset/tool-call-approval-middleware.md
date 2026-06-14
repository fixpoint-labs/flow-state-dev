---
"@flow-state-dev/core": minor
"@flow-state-dev/server": minor
---

Add per-tool-call human approval for generator tool loops. Set `requiresApproval` on a tool block, or a `toolApproval` policy on a generator, to require a human to approve a tool call before it runs. A gated call ends the model turn and suspends the request with the call details; a human approves or rejects via the resume endpoint. Approving executes the tool and the agent continues; rejecting returns a denial result the model adapts to. The model call that requested the tools is never replayed. Requires the action to run with a configured `DurabilityProvider`.

Also fixes a bug where a retry-configured durable action re-executed (replaying its model call) on every suspension: `SuspensionError` is now classified non-retryable.
