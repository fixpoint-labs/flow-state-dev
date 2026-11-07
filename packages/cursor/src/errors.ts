/**
 * Typed errors for `@flow-state-dev/cursor`.
 *
 * Each carries a stable `code` so a host or the manager branches on the failure
 * class without string-matching a message, mirroring the Codex and Claude Code
 * adapters' error style.
 *
 * Every one of them is FATAL for the run that raised it. A run Cursor reports as
 * errored is not here: that is an outcome on the handle, not a throw.
 */
import type { ClassifiedHarnessError, HarnessFailureKind } from "@flow-state-dev/core/harness";

/**
 * The optional `@cursor/sdk` peer dependency is not installed. Raised on the
 * first RUN, not at import and not when the block is built — a block can be
 * constructed on a host that never runs it.
 */
export class CursorSdkNotInstalledError extends Error {
  readonly code = "CURSOR_SDK_NOT_INSTALLED";
  constructor(message?: string, readonly detail?: { cause?: string }) {
    super(
      message ??
        "The `@cursor/sdk` package is not installed. Add it as a dependency, or pass a `resolveCursorClient` that supplies a Cursor client.",
    );
    this.name = "CursorSdkNotInstalledError";
  }
}

/**
 * A configuration mistake caught when the block is built: an option group
 * carrying something the block owns rather than forwards (a working directory,
 * an agent id), or a cloud bag this version does not drive.
 */
export class CursorAgentConfigError extends Error {
  readonly code = "CURSOR_AGENT_CONFIG_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "CursorAgentConfigError";
  }
}

/**
 * The run ended abnormally: the SDK threw creating, resuming or sending, the
 * stream threw, or the prompt was empty. Wraps the underlying message on
 * `detail.cause` so the caller sees a stable class without losing what the
 * vendor said.
 */
export class CursorAgentRunError extends Error implements ClassifiedHarnessError {
  readonly code = "CURSOR_AGENT_RUN_FAILED";
  /**
   * The failure in core's neutral vocabulary, read with core's
   * `harnessFailureKind`. `"unknown-conversation"` when Cursor refused to
   * resume the agent the run asked for (see {@link isUnknownAgentFailure});
   * `null` for every other failure.
   */
  readonly harnessFailure: HarnessFailureKind | null;
  /**
   * @param detail carries the underlying message as a string, the shape the
   *   sibling adapters use and the one a host can log.
   * @param cause the original throw, forwarded to `Error`'s own `cause` so the
   *   class and stack of whatever failed stay reachable. `detail.cause` alone
   *   loses both, which is the difference between "the SDK threw" and knowing
   *   what it threw and where.
   * @param harnessFailure see {@link CursorAgentRunError.harnessFailure}.
   */
  constructor(
    message: string,
    readonly detail?: { cause?: string },
    cause?: unknown,
    harnessFailure: HarnessFailureKind | null = null,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CursorAgentRunError";
    this.harnessFailure = harnessFailure;
  }
}

/**
 * Whether `err`, thrown by the SDK's `Agent.resume`, is Cursor saying it does
 * not know the agent.
 *
 * Measured against `@cursor/sdk` 1.0.31, and still the code in 1.0.40:
 * resuming an id the local store does not hold throws the SDK's
 * `AgentNotFoundError` ("Agent ID not found") with the stable code
 * `agent_not_found`. The code is what is matched: it survives
 * the trip out of the runtime's child process, where the class does not. The
 * block asks this only of an error from `resume` itself, so a run that resumed
 * the agent and then failed is never read as a refusal.
 */
export function isUnknownAgentFailure(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "agent_not_found";
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
export class CursorAgentAbortedError extends Error {
  readonly code = "CURSOR_AGENT_ABORTED";
  constructor(
    readonly sessionId: string | null,
    /** The stopping signal's reason, as the caller gave it. */
    readonly reason?: unknown,
  ) {
    super(
      sessionId === null
        ? "The Cursor run was aborted before it named an agent."
        : `The Cursor run was aborted. Agent ${sessionId} can be resumed.`,
      { cause: stopCause(reason) },
    );
    this.name = "CursorAgentAbortedError";
  }
}

/** An `AbortError` carrying a stop's reason as its message: the root of every stop's `cause` chain. */
function stopCause(reason: unknown): DOMException {
  const said = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return new DOMException(said === "" ? "This operation was aborted." : said, "AbortError");
}
