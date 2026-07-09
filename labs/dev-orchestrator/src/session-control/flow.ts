/**
 * The session-control flow — cloud Claude sessions self-report registration
 * and status here (see docs/session-telemetry-mcp.md). Exposed as an MCP
 * server via `mcp: { enabled: true }`; every action needs a `description`
 * since that becomes the MCP tool's description the agent reads.
 *
 * The registry (registry.ts) is a user-scoped resource collection, not
 * flow-session state — the MCP transport is stateless (a fresh flow session
 * per `tools/call`), so session-scope storage never survives between calls.
 * There's no real end user either — callers are machine sessions — so
 * `resolvePrincipal` always resolves the same fixed `userId`, which is what
 * makes user-scoped storage work here: every call, from every Claude
 * session, lands on the same identity, turning "user scope" into shared
 * storage for this flow. `requireUser` stays at the framework's Phase-1
 * default (true) rather than opting out: a user-scoped resource under
 * `requireUser: false` is a build-time error, and this resolver always
 * supplies a userId anyway, so there's nothing to opt out of.
 */
import { defineFlow } from "@flow-state-dev/core";
import { registerSessionInputSchema, reportStatusInputSchema } from "./schemas";
import { registerSession } from "./blocks/register-session";
import { buildReportStatus } from "./blocks/report-status";
import type { LinearStatusClient } from "../signals/linear";

export interface SessionControlFlowOptions {
  /** Deterministic Linear client for the board writes reportStatus decides on. */
  board: LinearStatusClient;
}

/** Build a `session-control` flow instance with injected dependencies. */
export function buildSessionControlFlow(options: SessionControlFlowOptions) {
  return defineFlow({
    kind: "session-control",
    authentication: {
      resolvePrincipal: () => ({ userId: "session-control" }),
    },
    mcp: { enabled: true },
    actions: {
      registerSession: {
        inputSchema: registerSessionInputSchema,
        block: registerSession,
        description:
          "Register this Claude session against the issue it is working. Call once, as the first " +
          "action, before reporting any status. Returns a capability token required on every " +
          "reportStatus call for this session.",
      },
      reportStatus: {
        inputSchema: reportStatusInputSchema,
        block: buildReportStatus(options.board),
        description:
          "Report this session's current status (working, awaiting-review, addressing-feedback, " +
          "done, errored) and optionally its PR number. Requires the capabilityToken returned by " +
          "registerSession.",
      },
    },
  })();
}
