/**
 * Session registry storage for the session-control flow prototype.
 *
 * Rows key on the external Claude `sessionId`, not any FSD scope — the MCP
 * transport is stateless (a fresh flow session per `tools/call`, per
 * @flow-state-dev/mcp), so the registry has to live outside flow-session
 * state. This in-memory store is a stand-in for the hosted DB a real
 * deployment would use (see docs/session-telemetry-mcp.md § Open questions).
 */
import type { OrchestrationStage } from "../types";
import type { SessionStatus } from "./schemas";

export interface SessionRegistryRow {
  sessionId: string;
  issue: string;
  stage: OrchestrationStage;
  /** Null until the first reportStatus call. */
  status: SessionStatus | null;
  prNumber: number | null;
  capabilityToken: string;
  registeredAt: number;
  lastSeen: number;
}

/** Injectable seam for the registry store — tests assert on the in-memory fake directly. */
export interface SessionRegistryStore {
  get(sessionId: string): Promise<SessionRegistryRow | null>;
  put(row: SessionRegistryRow): Promise<void>;
}

/** In-memory `SessionRegistryStore`. Prototype default; not durable across restarts. */
export function createInMemorySessionRegistryStore(): SessionRegistryStore {
  const rows = new Map<string, SessionRegistryRow>();
  return {
    async get(sessionId) {
      return rows.get(sessionId) ?? null;
    },
    async put(row) {
      rows.set(row.sessionId, row);
    },
  };
}
