---
"@flow-state-dev/contracts": patch
"@flow-state-dev/core": patch
"@flow-state-dev/workforce": patch
"@flow-state-dev/devtool": patch
---

A block that declines on a precondition reads as refused in the DevTool, not as a failure, and a workstream lead's `updateWorkstream` is offered only on a session that leads a workstream.

- **contracts / core:** `REFUSED_ERROR_CODE` (`"refused"`) and `isRefusal(item)` from `@flow-state-dev/core/items`. Throw a `FlowError` with `code: REFUSED_ERROR_CODE` for a refusal; the block's failed `block_trace` and `tool_output` carry the code, and `isRefusal` tells a renderer to draw it as refused.
- **devtool:** a refused block shows a neutral `refused` status in the trace and the stream, with its reason on the row and the whole error (message, code, details) in the block detail under a "Refused" heading. A block that broke stays red, and so does a request a refusal ended.
- **workforce:** `ProjectRefusedError` is now a `FlowError` with `code: "refused"` and `details: { reason }`. Its `name`, `reason` and message are unchanged, and `instanceof ProjectRefusedError` still matches. Because it is a non-retryable `FlowError`, a retry policy no longer runs a refused write again, and a refusal thrown from a view answers 422 rather than 500.
- **workforce:** a worker turn is no longer handed the lead's `updateWorkstream` on a session that leads no workstream, even when its `tools:` line names it. The write still refuses such a session (`not-a-workstream-session`). `offeredOnSession(tool, ctx)` is the check, for an app's own worker flow that resolves a catalog.

Docs: packages/workforce/README.md (projects: refusals are `FlowError`s coded `refused`; the lead's tool is offered on its workstream session only)
