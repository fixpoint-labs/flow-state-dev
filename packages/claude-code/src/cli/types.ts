/**
 * CLI-path handle type — the shape persisted in session state and returned by
 * the dispatch block. Extends the source-agnostic envelope with the fields a
 * `claude --remote` dispatch produces.
 */
import { z } from "zod";
import { remoteAgentTaskHandleSchema, type RemoteAgentTaskHandle } from "../shared/handle";

/**
 * Handle for a single `claude --remote` cloud dispatch.
 *
 * `status` is always `"dispatched"` in v0: the CLI exposes no headless way to
 * observe cloud-task progress, so the block is fire-and-forget. `raw` retains
 * the CLI's stdout verbatim so a future parser (or a human) can recover detail
 * the current parser missed.
 */
export interface ClaudeRemoteHandle extends RemoteAgentTaskHandle {
  source: "cli-remote";
  status: "dispatched";
  /** The instruction string passed to `claude --remote`. */
  instructions: string;
  /** Verbatim stdout from the dispatch invocation. */
  raw: string;
}

/** Runtime validator for {@link ClaudeRemoteHandle}. */
export const claudeRemoteHandleSchema = remoteAgentTaskHandleSchema.extend({
  source: z.literal("cli-remote"),
  status: z.literal("dispatched"),
  instructions: z.string(),
  raw: z.string(),
});
