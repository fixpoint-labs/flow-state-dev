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
 * An installed `@openai/codex-sdk` that is not the version this package was
 * tested against. Raised when the block is BUILT, so a host cannot start a run
 * on an untested wire and discover the mismatch from a malformed item stream.
 *
 * There is deliberately no override: the upgrade path is a release of this
 * package, which is what makes every Codex bump a tested one.
 */
export class CodexSdkVersionMismatchError extends Error {
  readonly code = "CODEX_SDK_VERSION_MISMATCH";
  /**
   * @param installed the version found, or `null` when an SDK is present but its
   *   version could not be established. The gate refuses in BOTH cases: "there
   *   is nothing installed" is safe, "I cannot tell what is installed" is not,
   *   and a gate that passed the second would let an unchecked wire run.
   * @param unreadableReason why the version could not be read, when it could not.
   */
  constructor(
    readonly installed: string | null,
    readonly tested: string,
    readonly unreadableReason?: string,
  ) {
    super(
      (installed === null
        ? `\`@openai/codex-sdk\` is installed but its version could not be determined (${unreadableReason ?? "reason unknown"}), and @flow-state-dev/codex is tested against exactly ${tested}. `
        : `\`@openai/codex-sdk\` ${installed} is installed, but @flow-state-dev/codex is tested against exactly ${tested}. `) +
        "Codex's JSONL wire is experimental and can change in a lockstep CLI+SDK release, so this package refuses to run against a version it has not checked. " +
        (installed === null
          ? `Install \`@openai/codex-sdk\` ${tested} in a layout this package can read, or pass your own \`resolveCodexClient\`.`
          : `Pin \`@openai/codex-sdk\` to ${tested}, or take a release of @flow-state-dev/codex that tests ${installed}.`),
    );
    this.name = "CodexSdkVersionMismatchError";
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
export class CodexAgentRunError extends Error {
  readonly code = "CODEX_AGENT_RUN_FAILED";
  /**
   * @param detail carries the underlying message as a string, the shape the
   *   Claude Code adapter's equivalent uses and the one a host can log.
   * @param cause the original throw, forwarded to `Error`'s own `cause` so the
   *   class and stack of whatever failed stay reachable. `detail.cause` alone
   *   loses both, which is the difference between "the SDK threw" and knowing
   *   what it threw and where.
   */
  constructor(message: string, readonly detail?: { cause?: string }, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CodexAgentRunError";
  }
}

/**
 * The caller's signal fired. A cancelled run is a throw and never a handle
 * (LAB-152 §9), and this class is what distinguishes "you stopped it" from "it
 * broke" for a manager deciding whether to retry.
 */
export class CodexAgentAbortedError extends Error {
  readonly code = "CODEX_AGENT_ABORTED";
  constructor(readonly sessionId: string | null) {
    super(
      sessionId === null
        ? "The Codex run was aborted before it named a thread."
        : `The Codex run was aborted. Thread ${sessionId} can be resumed.`,
    );
    this.name = "CodexAgentAbortedError";
  }
}
