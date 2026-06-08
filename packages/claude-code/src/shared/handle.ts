/**
 * Source-agnostic remote-agent task handle.
 *
 * Both the CLI dispatch path (`./cli`, this issue) and the future in-process
 * Agent SDK path (`./sdk`) produce something a downstream block may want to
 * consume uniformly: a reference to an agent run, its status, and where to
 * watch it. This is the minimal shape they share. Each path extends it with
 * path-specific fields (see `ClaudeRemoteHandle` in `../cli/types`).
 *
 * Keep this module dependency-free and minimal — it is the contract the two
 * entry points agree on, so widening it is a coordinated change.
 */
import { z } from "zod";

/** Which execution model produced the handle. */
export type RemoteAgentSource = "cli-remote" | "sdk";

/**
 * Lifecycle status. The CLI path only ever reports `"dispatched"` in v0
 * (fire-and-forget — the CLI exposes no headless way to poll cloud-task
 * progress); the other states exist for the SDK path and a future polling
 * layer that resolves a persisted handle.
 */
export type RemoteAgentStatus = "dispatched" | "running" | "completed" | "errored";

/** The fields a downstream block can rely on regardless of execution model. */
export interface RemoteAgentTaskHandle {
  source: RemoteAgentSource;
  status: RemoteAgentStatus;
  /** Provider session/task id, when one could be determined. */
  sessionId: string | null;
  /** Human-openable URL for the task (e.g. claude.ai/code), when known. */
  url: string | null;
  /** Epoch millis when the handle was created. */
  dispatchedAt: number;
}

/** Runtime validator for {@link RemoteAgentTaskHandle}. */
export const remoteAgentTaskHandleSchema = z.object({
  source: z.enum(["cli-remote", "sdk"]),
  status: z.enum(["dispatched", "running", "completed", "errored"]),
  sessionId: z.string().nullable(),
  url: z.string().nullable(),
  dispatchedAt: z.number(),
});
