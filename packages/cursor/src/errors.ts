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
 * An installed `@cursor/sdk` that is not the version this package was tested
 * against. Raised when the block is BUILT, so a host cannot start a run on an
 * untested wire and discover the mismatch from a malformed message stream.
 *
 * There is deliberately no override: the upgrade path is a release of this
 * package, which is what makes every Cursor bump a tested one.
 */
export class CursorSdkVersionMismatchError extends Error {
  readonly code = "CURSOR_SDK_VERSION_MISMATCH";
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
        ? `\`@cursor/sdk\` is installed but its version could not be determined (${unreadableReason ?? "reason unknown"}), and @flow-state-dev/cursor is tested against exactly ${tested}. `
        : `\`@cursor/sdk\` ${installed} is installed, but @flow-state-dev/cursor is tested against exactly ${tested}. `) +
        "Cursor's SDK ships its local runtime as a native binary and its message wire can change between patch releases, so this package refuses to run against a version it has not checked. " +
        (installed === null
          ? // Deliberately NOT offering `resolveCursorClient` as the escape: the
            // gate runs when the block is built, before any client is resolved,
            // so supplying one does not get past it. An error that names a way
            // out that does not work is worse than one that names none.
            `Install \`@cursor/sdk\` ${tested} in a layout this package can read.`
          : `Pin \`@cursor/sdk\` to ${tested}, or take a release of @flow-state-dev/cursor that tests ${installed}.`),
    );
    this.name = "CursorSdkVersionMismatchError";
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
export class CursorAgentRunError extends Error {
  readonly code = "CURSOR_AGENT_RUN_FAILED";
  /**
   * @param detail carries the underlying message as a string, the shape the
   *   sibling adapters use and the one a host can log.
   * @param cause the original throw, forwarded to `Error`'s own `cause` so the
   *   class and stack of whatever failed stay reachable. `detail.cause` alone
   *   loses both, which is the difference between "the SDK threw" and knowing
   *   what it threw and where.
   */
  constructor(message: string, readonly detail?: { cause?: string }, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CursorAgentRunError";
  }
}

/**
 * The caller's signal fired. A cancelled run is a throw and never a handle
 * (LAB-152 §9), and this class is what distinguishes "you stopped it" from "it
 * broke" for a manager deciding whether to retry.
 */
export class CursorAgentAbortedError extends Error {
  readonly code = "CURSOR_AGENT_ABORTED";
  constructor(readonly sessionId: string | null) {
    super(
      sessionId === null
        ? "The Cursor run was aborted before it named an agent."
        : `The Cursor run was aborted. Agent ${sessionId} can be resumed.`,
    );
    this.name = "CursorAgentAbortedError";
  }
}
