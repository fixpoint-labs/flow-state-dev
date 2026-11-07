/**
 * Typed errors for the in-process Agent SDK path (`./sdk`). Each carries a stable
 * `code` so hosts and the orchestrator can branch on the failure class without
 * string-matching messages, mirroring the CLI path's error-class style.
 */
import type { ClassifiedHarnessError, HarnessFailureKind } from "@flow-state-dev/core/harness";

/**
 * The optional `@anthropic-ai/claude-agent-sdk` peer dependency is not
 * installed. Fatal: the agent block cannot run its `query()` loop without it.
 */
export class ClaudeCodeSdkNotInstalledError extends Error {
  readonly code = "CLAUDE_AGENT_SDK_NOT_INSTALLED";
  constructor(message?: string, readonly detail?: { cause?: string }) {
    super(
      message ??
        "The `@anthropic-ai/claude-agent-sdk` package is not installed. Add it as a dependency, or pass a `resolveClaudeAgent` that supplies a `query` function.",
    );
    this.name = "ClaudeCodeSdkNotInstalledError";
  }
}

/**
 * The SDK `query()` loop threw mid-stream. Wraps the underlying error so the
 * caller sees a stable class while the original message is preserved on
 * `detail.cause`. The agent block emits an error item and rethrows this.
 */
export class ClaudeCodeAgentRunError extends Error implements ClassifiedHarnessError {
  readonly code = "CLAUDE_AGENT_RUN_FAILED";
  /**
   * The failure in core's neutral vocabulary, read with core's
   * `harnessFailureKind`. `"unknown-conversation"` when Claude Code refused to
   * continue the conversation the run asked to resume; `null` for every other
   * failure. See {@link isUnknownConversationFailure}.
   */
  readonly harnessFailure: HarnessFailureKind | null;
  constructor(
    message: string,
    readonly detail?: { cause?: string },
    harnessFailure: HarnessFailureKind | null = null,
  ) {
    super(message);
    this.name = "ClaudeCodeAgentRunError";
    this.harnessFailure = harnessFailure;
  }
}

/**
 * The caller's signal fired. A stopped run is a throw and never a handle, and
 * this is what tells "you stopped it" from "it broke" for a host deciding
 * whether to retry.
 *
 * A host tells it with core's `isAbortLike`, whatever stopped the run: the
 * root of its `cause` chain is always an `AbortError`, whose message is the
 * signal's reason. The reason itself (a deadline's `TimeoutError`, a plain
 * `Error`, or none) is on {@link reason}.
 */
export class ClaudeCodeAgentAbortedError extends Error {
  readonly code = "CLAUDE_CODE_AGENT_ABORTED";
  constructor(
    /** The session Claude Code had named when the run was stopped, which a host resumes; `null` before it named one. */
    readonly sessionId: string | null,
    /** The stopping signal's reason, as the caller gave it. */
    readonly reason?: unknown,
  ) {
    super(
      sessionId === null
        ? "The Claude Code run was aborted before it named a session."
        : `The Claude Code run was aborted. Session ${sessionId} can be resumed.`,
      { cause: stopCause(reason) },
    );
    this.name = "ClaudeCodeAgentAbortedError";
  }
}

/** An `AbortError` carrying a stop's reason as its message: the root of every stop's `cause` chain. */
function stopCause(reason: unknown): DOMException {
  const said = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return new DOMException(said === "" ? "This operation was aborted." : said, "AbortError");
}

/**
 * Whether a failed run was Claude Code refusing to continue `resumeId`.
 *
 * Measured against Claude Code 2.1.296 and `@anthropic-ai/claude-agent-sdk`
 * 0.3.234, resuming an id it has no transcript for: the process emits one
 * `result` message (`subtype: "error_during_execution"`, `is_error: true`,
 * `errors: ["No conversation found with session ID: <id>"]`, and the
 * **requested** id as its `session_id`), exits 1, and the SDK throws
 * `Claude Code returned an error result: No conversation found with session ID: <id>`.
 * Older SDKs throw a bare exit error and leave the sentence on stderr, so both
 * are checked.
 *
 * Matched on the requested id, not the sentence alone, so a run that resumed
 * one conversation and then failed over another is not called a refusal.
 */
export function isUnknownConversationFailure(
  resumeId: string,
  message: string,
  stderrTail: string,
): boolean {
  if (resumeId === "") return false;
  return namesRefusal(message, resumeId) || namesRefusal(stderrTail, resumeId);
}

/** Whether `text` holds the refusal sentence for exactly `id`, not an id it prefixes. */
function namesRefusal(text: string, id: string): boolean {
  const sentence = `No conversation found with session ID: ${id}`;
  for (let at = text.indexOf(sentence); at !== -1; at = text.indexOf(sentence, at + 1)) {
    const next = text[at + sentence.length];
    if (next === undefined || !/[\w-]/.test(next)) return true;
  }
  return false;
}
