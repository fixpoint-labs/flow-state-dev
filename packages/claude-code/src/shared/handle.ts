/**
 * Source-agnostic remote-agent task handle.
 *
 * The in-process Agent SDK path (`./sdk`) returns a reference to an agent
 * run, its status, and where to watch it. Keep this module
 * dependency-free and minimal.
 */
import { z } from "zod";

/** Which execution model produced the handle. */
export type RemoteAgentSource = "sdk";

/** Lifecycle status of an agent run. */
export type RemoteAgentStatus = "dispatched" | "running" | "completed" | "errored";

/** The fields a downstream block can rely on regardless of execution model. */
export interface RemoteAgentTaskHandle {
  source: RemoteAgentSource;
  status: RemoteAgentStatus;
  /** Provider session/task id, when one could be determined. */
  sessionId: string | null;
  /** Human-openable URL for the task, when known. */
  url: string | null;
  /** Epoch millis when the handle was created. */
  dispatchedAt: number;
}

/** Runtime validator for {@link RemoteAgentTaskHandle}. */
export const remoteAgentTaskHandleSchema = z.object({
  source: z.enum(["sdk"]),
  status: z.enum(["dispatched", "running", "completed", "errored"]),
  sessionId: z.string().nullable(),
  url: z.string().nullable(),
  dispatchedAt: z.number(),
});
