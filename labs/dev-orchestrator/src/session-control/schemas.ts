/**
 * Zod schemas for the session-control flow's two actions.
 *
 * Serializable, plain-object shapes only — these cross the MCP JSON-RPC
 * boundary (action `inputSchema` becomes the MCP tool's input schema) so they
 * stay free of anything that doesn't round-trip through JSON.
 */
import { z } from "zod";
import type { OrchestrationStage } from "../types";

const ORCHESTRATION_STAGES = ["spec", "implement", "review"] as const satisfies readonly OrchestrationStage[];

/** Milestones a dispatched Claude session reports about its own progress. */
export const sessionStatusSchema = z.enum([
  "working",
  "awaiting-review",
  "addressing-feedback",
  "done",
  "errored",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/** The agent's first call — binds its own session_id to the issue it's working. */
export const registerSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  issue: z.string().min(1),
  stage: z.enum(ORCHESTRATION_STAGES),
});
export type RegisterSessionInput = z.infer<typeof registerSessionInputSchema>;

export const registerSessionOutputSchema = z.object({
  capabilityToken: z.string(),
});
export type RegisterSessionOutput = z.infer<typeof registerSessionOutputSchema>;

/** A status milestone report. `capabilityToken` is the one returned by registerSession. */
export const reportStatusInputSchema = z.object({
  sessionId: z.string().min(1),
  capabilityToken: z.string().min(1),
  status: sessionStatusSchema,
  prNumber: z.number().int().positive().optional(),
});
export type ReportStatusInput = z.infer<typeof reportStatusInputSchema>;

export const reportStatusOutputSchema = z.object({
  acknowledged: z.literal(true),
});
export type ReportStatusOutput = z.infer<typeof reportStatusOutputSchema>;
