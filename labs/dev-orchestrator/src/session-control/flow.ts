/**
 * The session-control flow — cloud Claude sessions self-report registration
 * and status here (see docs/session-telemetry-mcp.md). Exposed as an MCP
 * server via `mcp: { enabled: true }`; every action needs a `description`
 * since that becomes the MCP tool's description the agent reads.
 *
 * No FSD scope state: the registry lives in an injected store, not
 * flow-session state, because the MCP transport is stateless (a fresh flow
 * session per `tools/call` — state wouldn't survive between calls). No end
 * user either — callers are machine sessions, not humans — so the flow opts
 * out of the user-identity requirement, mirroring the pattern
 * @flow-state-dev/mcp's own tests use for machine-driven flows.
 */
import { defineFlow } from "@flow-state-dev/core";
import { registerSessionInputSchema, reportStatusInputSchema } from "./schemas";
import { buildRegisterSession } from "./blocks/register-session";
import { buildReportStatus } from "./blocks/report-status";
import { createInMemorySessionRegistryStore, type SessionRegistryStore } from "./registry";
import type { LinearStatusClient } from "../signals/linear";

export interface SessionControlFlowOptions {
  /** Deterministic Linear client for the board writes reportStatus decides on. */
  board: LinearStatusClient;
  /** Registry store. Defaults to an in-memory prototype store. */
  registry?: SessionRegistryStore;
}

/** Build a `session-control` flow instance with injected dependencies. */
export function buildSessionControlFlow(options: SessionControlFlowOptions) {
  const registry = options.registry ?? createInMemorySessionRegistryStore();

  return defineFlow({
    kind: "session-control",
    requireUser: false,
    authentication: {
      requireUser: false,
      resolvePrincipal: () => ({ userId: "session-control" }),
    },
    mcp: { enabled: true },
    actions: {
      registerSession: {
        inputSchema: registerSessionInputSchema,
        block: buildRegisterSession(registry),
        description:
          "Register this Claude session against the issue it is working. Call once, as the first " +
          "action, before reporting any status. Returns a capability token required on every " +
          "reportStatus call for this session.",
      },
      reportStatus: {
        inputSchema: reportStatusInputSchema,
        block: buildReportStatus(registry, options.board),
        description:
          "Report this session's current status (working, awaiting-review, addressing-feedback, " +
          "done, errored) and optionally its PR number. Requires the capabilityToken returned by " +
          "registerSession.",
      },
    },
  })();
}
