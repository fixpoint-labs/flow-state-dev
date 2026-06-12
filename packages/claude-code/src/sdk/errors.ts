/**
 * Typed errors for the in-process Agent SDK path (`./sdk`). Both carry a stable
 * `code` so hosts and the orchestrator can branch on the failure class without
 * string-matching messages, mirroring the CLI path's error-class style.
 */

/**
 * The optional `@anthropic-ai/claude-agent-sdk` peer dependency is not
 * installed. Fatal: the agent block cannot run its `query()` loop without it.
 */
export class ClaudeAgentSdkNotInstalledError extends Error {
  readonly code = "CLAUDE_AGENT_SDK_NOT_INSTALLED";
  constructor(message?: string, readonly detail?: { cause?: string }) {
    super(
      message ??
        "The `@anthropic-ai/claude-agent-sdk` package is not installed. Add it as a dependency, or pass a `resolveClaudeAgent` that supplies a `query` function.",
    );
    this.name = "ClaudeAgentSdkNotInstalledError";
  }
}

/**
 * The SDK `query()` loop threw mid-stream. Wraps the underlying error so the
 * caller sees a stable class while the original message is preserved on
 * `detail.cause`. The agent block emits an error item and rethrows this.
 */
export class ClaudeAgentRunError extends Error {
  readonly code = "CLAUDE_AGENT_RUN_FAILED";
  constructor(message: string, readonly detail?: { cause?: string }) {
    super(message);
    this.name = "ClaudeAgentRunError";
  }
}
