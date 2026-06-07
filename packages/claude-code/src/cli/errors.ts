/**
 * Typed errors for the CLI dispatch path. Both carry a stable `code` so hosts
 * and the orchestrator can branch on the failure class without string-matching
 * messages.
 */

/** The `claude` binary could not be found / executed. A host-config problem. */
export class ClaudeCliNotFoundError extends Error {
  readonly code = "CLAUDE_CLI_NOT_FOUND";
  constructor(message?: string) {
    super(
      message ??
        "The `claude` CLI was not found. Install Claude Code and ensure `claude` is on PATH, or pass a `resolveClaudeCli` that returns its path.",
    );
    this.name = "ClaudeCliNotFoundError";
  }
}

/** `claude --remote` was invoked but did not dispatch successfully. */
export class ClaudeRemoteDispatchError extends Error {
  readonly code = "CLAUDE_REMOTE_DISPATCH_FAILED";
  constructor(
    message: string,
    readonly detail?: { exitCode?: number; stderr?: string; cause?: string },
  ) {
    super(message);
    this.name = "ClaudeRemoteDispatchError";
  }
}
