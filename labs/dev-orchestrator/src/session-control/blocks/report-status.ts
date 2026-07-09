/**
 * `reportStatus` — the agent's status updates after registration. Requires
 * the capability token issued by `registerSession` for this `sessionId`;
 * mismatched or missing tokens are rejected (see docs/session-telemetry-mcp.md
 * § Security — this is what closes the gap where `sessionId` alone, being
 * public via commit trailers/PR bodies, isn't proof of caller identity).
 *
 * Updates the registry row and, when `boardStateForStatus` maps the report to
 * a board state, asserts that state on Linear through the injected client —
 * the flow owns the write, the agent only reports intent.
 */
import { handler } from "@flow-state-dev/core";
import {
  reportStatusInputSchema,
  reportStatusOutputSchema,
  type ReportStatusOutput,
} from "../schemas";
import { sessionRegistryCollection } from "../registry";
import { boardStateForStatus } from "../status-map";
import type { LinearStatusClient } from "../../signals/linear";

export function buildReportStatus(board: LinearStatusClient) {
  return handler({
    name: "report-status",
    inputSchema: reportStatusInputSchema,
    outputSchema: reportStatusOutputSchema,
    resources: { sessions: sessionRegistryCollection },
    execute: async (input, ctx): Promise<ReportStatusOutput> => {
      const sessions = ctx.resources.sessions;
      const existing = await sessions.getOptional({ sessionId: input.sessionId });
      if (existing === undefined) {
        throw new Error(`Session "${input.sessionId}" is not registered. Call registerSession first.`);
      }
      if (existing.state.capabilityToken !== input.capabilityToken) {
        throw new Error(`Invalid capability token for session "${input.sessionId}".`);
      }

      await existing.patchState({
        status: input.status,
        prNumber: input.prNumber ?? existing.state.prNumber,
        lastSeen: Date.now(),
      });

      const target = boardStateForStatus({ stage: existing.state.stage, status: input.status });
      if (target !== null) {
        await board.transitionTo(existing.state.issue, target);
      }

      return { acknowledged: true };
    },
  });
}
