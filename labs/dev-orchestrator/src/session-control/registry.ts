/**
 * Session registry — a user-scoped resource collection, keyed by `sessionId`.
 *
 * Session-scoped resources are a non-starter: the MCP transport is stateless
 * (a fresh flow session per `tools/call`, per @flow-state-dev/mcp), so
 * session-scope storage never survives between `registerSession` and a later
 * `reportStatus`. User scope does survive, and only because this flow's
 * `authentication.resolvePrincipal` (see flow.ts) always resolves the same
 * fixed `userId` — every MCP call, from every Claude session, lands on the
 * same identity, so user-scoped storage is effectively shared/global for this
 * flow rather than per-caller data.
 *
 * Keyed flat by `sessionId` (not issue-prefixed) so the reject-on-reassignment
 * check in register-session.ts stays an O(1) lookup. Enumerating sessions by
 * issue (a real future need — see docs/session-telemetry-mcp.md § The gap)
 * would cost an O(n) `list()` + filter under this scheme; that's no worse
 * than before this was a resource, and no current action needs it, so an
 * issue-prefixed pattern is left for when a real consumer asks for it.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";
import type { OrchestrationStage } from "../types";
import { sessionStatusSchema } from "./schemas";

const ORCHESTRATION_STAGES = ["spec", "implement", "review"] as const satisfies readonly OrchestrationStage[];

export const sessionRegistrySchema = z.object({
  issue: z.string(),
  stage: z.enum(ORCHESTRATION_STAGES),
  /** Null until the first reportStatus call. */
  status: sessionStatusSchema.nullable().default(null),
  prNumber: z.number().int().positive().nullable().default(null),
  capabilityToken: z.string(),
  registeredAt: z.number(),
  lastSeen: z.number(),
});
export type SessionRegistryState = z.infer<typeof sessionRegistrySchema>;

/** One instance per `sessionId`. Register under `userResources` on any block that needs it. */
export const sessionRegistryCollection = defineResourceCollection({
  ref: "sessions",
  pattern: "sessions/[sessionId]",
  scope: "user",
  stateSchema: sessionRegistrySchema,
});
