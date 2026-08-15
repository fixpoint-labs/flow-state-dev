/**
 * The error vocabulary of the in-process Agent SDK path (`./sdk`): the two typed
 * errors this path throws, and the one reader that turns something *else* threw
 * into text. Both classes carry a stable `code` so hosts and the orchestrator can
 * branch on the failure class without string-matching messages, mirroring the CLI
 * path's error-class style.
 */

/**
 * A thrown value as text a human can act on.
 *
 * `catch` binds `unknown`, and a rejected promise carries whatever it was
 * rejected with — `null`, `undefined`, and a bare string are all real. Reading
 * `.message` off one of those throws a fresh `TypeError` out of the handler that
 * exists to *contain* the failure, or quietly yields `undefined` and loses what
 * happened. Both matter here because this path backs surfaces whose contract is
 * to settle rather than throw (`runClaudeHeadless`, and conductor's `Dispatcher`
 * behind it): a thrown exception skips the caller's ledger and loses the
 * transition, where a settled failure is recorded and escalated.
 */
export function describeThrown(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

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
