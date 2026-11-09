---
"@flow-state-dev/claude-code": minor
"@flow-state-dev/codex": minor
"@flow-state-dev/cursor": minor
---

A stopped run reads as a stop in all three coding harnesses, whatever stopped it (FIX-2458).

- **claude-code, codex, cursor:** the error a stopped run throws is abort-like to core's `isAbortLike`, whether the signal fired with no reason, a deadline's `TimeoutError` or a plain `Error`. The root of its `cause` chain is an `AbortError` whose message is the reason. Tell a stop from a failure with `isAbortLike(err)`, the same way for all three. A harness block used as a generator's tool now stops the generator when its run is stopped, where before the model was handed a failed call.
- **claude-code:** a stopped run throws the new `ClaudeCodeAgentAbortedError` (`code: "CLAUDE_CODE_AGENT_ABORTED"`), with `sessionId`, the session to resume, and `reason`, the signal's own reason. Before, it threw the signal's reason itself. If you compared the thrown error with your signal's reason, or checked it for `TimeoutError`, read `err.reason` instead. The error item a stopped run shows is unchanged.
- **codex, cursor:** `CodexAgentAbortedError` and `CursorAgentAbortedError` take the signal's reason as a second constructor argument and expose it as `reason`. Their `sessionId`, `code` and message are unchanged.

Docs: packages/claude-code/README.md (`ClaudeCodeAgentAbortedError` among the errors; a stop is read with `isAbortLike`), packages/codex/README.md and packages/cursor/README.md (their stop errors are abort-like whatever the reason, with `reason`), apps/docs/docs/tools/coding-agents.md (telling a stop from a failure with `isAbortLike`, the same for all three), apps/docs/docs/tools/claude-code-sdk.md (a stop throws `ClaudeCodeAgentAbortedError`, no longer the signal's reason)
