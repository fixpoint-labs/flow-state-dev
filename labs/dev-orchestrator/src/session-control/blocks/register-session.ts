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
import { sessionRegistryCollection } from "../registry";

export const registerSession = handler({
  name: "register-session",
  inputSchema: registerSessionInputSchema,
  outputSchema: registerSessionOutputSchema,
  resources: { sessions: sessionRegistryCollection },
  execute: async (input, ctx): Promise<RegisterSessionOutput> => {
    const sessions = ctx.resources.sessions;
    const existing = await sessions.getOptional({ sessionId: input.sessionId });

    if (existing !== undefined) {
      if (existing.state.issue !== input.issue) {
        throw new Error(
          `Session "${input.sessionId}" is already registered to issue "${existing.state.issue}" ` +
            `and cannot be reassigned to "${input.issue}".`,
        );
      }
      // Idempotent re-registration (e.g. a resumed session) — keep the
      // existing token rather than rotating it.
      await existing.patchState({ stage: input.stage, lastSeen: Date.now() });
      return { capabilityToken: existing.state.capabilityToken };
    }

    const now = Date.now();
    const capabilityToken = randomUUID();
    await sessions.create(
      { sessionId: input.sessionId },
      {
        issue: input.issue,
        stage: input.stage,
        status: null,
        prNumber: null,
        capabilityToken,
        registeredAt: now,
        lastSeen: now,
      },
    );
    return { capabilityToken };
  },
});
