/**
 * CLI-path handle type — the shape persisted in session state and returned by
 * the dispatch block. Extends the framework's neutral harness envelope
 * (`@flow-state-dev/core`) with the fields a `claude --remote` dispatch
 * produces.
 *
 * The envelope only, not the fuller harness handle: `claude --remote` is
 * fire-and-forget, so there is no outcome, no final message, no usage and no
 * cost to report. That is also why this door is not a manager-drivable harness.
 */
import { z } from "zod";
import { harnessRunEnvelopeSchema } from "@flow-state-dev/core";
import type { HarnessRunEnvelope } from "@flow-state-dev/core/types";

/**
 * This door's `<package>/<door>` name, the convention every writer of a
 * harness handle's `source` follows.
 */
export const CLAUDE_CLI_REMOTE_SOURCE = "claude-code/cli-remote" as const;

/** The pre-LAB-152 spelling, still found in handles persisted before the rule. */
const LEGACY_CLI_REMOTE_SOURCE = "cli-remote";

/**
 * Handle for a single `claude --remote` cloud dispatch.
 *
 * `status` is always `"dispatched"` in v0: the CLI exposes no headless way to
 * observe cloud-task progress, so the block is fire-and-forget. `raw` retains
 * the CLI's stdout verbatim so a future parser (or a human) can recover detail
 * the current parser missed.
 */
export interface ClaudeRemoteHandle extends HarnessRunEnvelope {
  source: typeof CLAUDE_CLI_REMOTE_SOURCE;
  status: "dispatched";
  /** The instruction string passed to `claude --remote`. */
  instructions: string;
  /** Verbatim stdout from the dispatch invocation. */
  raw: string;
}

/**
 * Runtime validator for {@link ClaudeRemoteHandle}.
 *
 * A handle persisted under the old `"cli-remote"` spelling reads through to the
 * new value rather than failing (BP-030) — nothing branches on either, and the
 * point of pinning the convention is that the two are the same door.
 */
export const claudeRemoteHandleSchema = harnessRunEnvelopeSchema.extend({
  source: z.preprocess(
    (value) => (value === LEGACY_CLI_REMOTE_SOURCE ? CLAUDE_CLI_REMOTE_SOURCE : value),
    z.literal(CLAUDE_CLI_REMOTE_SOURCE),
  ),
  status: z.literal("dispatched"),
  instructions: z.string(),
  raw: z.string(),
});
