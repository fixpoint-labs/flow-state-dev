/**
 * Typed errors for `@flow-state-dev/codex`.
 *
 * Each carries a stable `code` so a host or the manager branches on the failure
 * class without string-matching a message, mirroring the Claude Code adapter's
 * error style.
 *
 * Every one of them is FATAL for the run that raised it. A turn the model
 * failed is not here: that is an outcome on the handle, not a throw (§9).
 */
import type { ClassifiedHarnessError, HarnessFailureKind } from "@flow-state-dev/core/harness";

/**
 * The optional `@openai/codex-sdk` peer dependency is not installed. Raised on
 * the first RUN, not at import and not when the block is built — a block can be
 * constructed on a host that never runs it.
 */
export class CodexSdkNotInstalledError extends Error {
  readonly code = "CODEX_SDK_NOT_INSTALLED";
  constructor(message?: string, readonly detail?: { cause?: string }) {
    super(
      message ??
        "The `@openai/codex-sdk` package is not installed. Add it as a dependency, or pass a `resolveCodexClient` that supplies a Codex client.",
    );
    this.name = "CodexSdkNotInstalledError";
  }
}

/**
 * A configuration mistake caught when the block is built: an option group
 * carrying something the block owns rather than forwards (a working directory,
 * a turn signal).
 */
export class CodexAgentConfigError extends Error {
  readonly code = "CODEX_AGENT_CONFIG_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "CodexAgentConfigError";
  }
}

/**
 * The run ended abnormally: the CLI exited non-zero, the stream threw, or the
 * prompt was empty. Wraps the underlying message on `detail.cause` so the
 * caller sees a stable class without losing what the vendor said.
 */
export class CodexAgentRunError extends Error implements ClassifiedHarnessError {
  readonly code = "CODEX_AGENT_RUN_FAILED";
  /**
   * The failure in core's neutral vocabulary, read with core's
   * `harnessFailureKind`. `"unknown-conversation"` when Codex refused to
   * resume the thread the run asked for (see {@link isUnknownThreadFailure});
   * `null` for every other failure.
   */
  readonly harnessFailure: HarnessFailureKind | null;
  /**
   * @param detail carries the underlying message as a string, the shape the
   *   Claude Code adapter's equivalent uses and the one a host can log.
   * @param cause the original throw, forwarded to `Error`'s own `cause` so the
   *   class and stack of whatever failed stay reachable. `detail.cause` alone
   *   loses both, which is the difference between "the SDK threw" and knowing
   *   what it threw and where.
   * @param harnessFailure see {@link CodexAgentRunError.harnessFailure}.
   */
  constructor(
    message: string,
    readonly detail?: { cause?: string },
    cause?: unknown,
    harnessFailure: HarnessFailureKind | null = null,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CodexAgentRunError";
    this.harnessFailure = harnessFailure;
  }
}

/**
 * Whether `reason`, the message of a run that named no thread, is Codex
 * saying it has no record of `resumeId`.
 *
 * Measured on the real CLI at 0.152.1: resuming an id whose record is gone,
 * the CLI names no thread, exits 1, and the SDK throws
 * `Codex Exec exited with code 1: … thread/resume failed: no rollout found for
 * thread id <id> (code -32600)`. Matched on the requested id, not the phrase
 * alone, so only a refusal of the thread this run asked for counts.
 */
export function isUnknownThreadFailure(reason: string, resumeId: string): boolean {
  return reason.includes(`no rollout found for thread id ${resumeId}`);
}

/**
 * The caller's signal fired. A cancelled run is a throw and never a handle
 * (LAB-152 §9), and this is what tells "you stopped it" from "it broke" for a
 * manager deciding whether to retry.
 *
 * A host tells it with core's `isAbortLike`, whatever stopped the run: the
 * root of its `cause` chain is always an `AbortError`, whose message is the
 * signal's reason. The reason itself (a deadline's `TimeoutError`, a plain
 * `Error`, or none) is on {@link reason}.
 */
export class CodexAgentAbortedError extends Error {
  readonly code = "CODEX_AGENT_ABORTED";
  constructor(
    readonly sessionId: string | null,
    /** The stopping signal's reason, as the caller gave it. */
    readonly reason?: unknown,
  ) {
    super(
      sessionId === null
        ? "The Codex run was aborted before it named a thread."
        : `The Codex run was aborted. Thread ${sessionId} can be resumed.`,
      { cause: stopCause(reason) },
    );
    this.name = "CodexAgentAbortedError";
  }
}

/** An `AbortError` carrying a stop's reason as its message: the root of every stop's `cause` chain. */
function stopCause(reason: unknown): DOMException {
  const said = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return new DOMException(said === "" ? "This operation was aborted." : said, "AbortError");
}
