/**
 * `registerSession` — the agent's first call. First sight of a `sessionId`
 * binds it to `issue`; a later call for the same `sessionId` under a
 * different `issue` is rejected (a session, once bound, stays bound — see
 * docs/session-telemetry-mcp.md § "The session-control flow"). Returns an
 * opaque capability token scoped to the registration; `reportStatus` requires
 * it on every subsequent call for this `sessionId` (see § Security).
 */
import { randomUUID } from "node:crypto";
import { handler } from "@flow-state-dev/core";
import {
  registerSessionInputSchema,
  registerSessionOutputSchema,
  type RegisterSessionOutput,
} from "../schemas";
import type { SessionRegistryStore } from "../registry";

export function buildRegisterSession(registry: SessionRegistryStore) {
  return handler({
    name: "register-session",
    inputSchema: registerSessionInputSchema,
    outputSchema: registerSessionOutputSchema,
    execute: async (input): Promise<RegisterSessionOutput> => {
      const existing = await registry.get(input.sessionId);

      if (existing !== null) {
        if (existing.issue !== input.issue) {
          throw new Error(
            `Session "${input.sessionId}" is already registered to issue "${existing.issue}" ` +
              `and cannot be reassigned to "${input.issue}".`,
          );
        }
        // Idempotent re-registration (e.g. a resumed session) — keep the
        // existing token rather than rotating it.
        await registry.put({ ...existing, stage: input.stage, lastSeen: Date.now() });
        return { capabilityToken: existing.capabilityToken };
      }

      const now = Date.now();
      const capabilityToken = randomUUID();
      await registry.put({
        sessionId: input.sessionId,
        issue: input.issue,
        stage: input.stage,
        status: null,
        prNumber: null,
        capabilityToken,
        registeredAt: now,
        lastSeen: now,
      });
      return { capabilityToken };
    },
  });
}
