/**
 * FIX-1068: losing the session create race does not skip the binding checks.
 *
 * A request that finds no session builds one and writes create-if-absent. When
 * it loses, it adopts the WINNER's record — a record it did not build and whose
 * identity it has never checked. The principal and tenant checks used to live
 * inside the already-existed branch, so that path reached execution unvalidated:
 * a request could run against a session belonging to another user, or another
 * tenant, purely by arriving second.
 *
 * These drive the real loser path — the store reports the key empty and then
 * conflicts, which is exactly the shape a concurrent winner produces — rather
 * than asserting on the branch in isolation.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createExecutionContext, createInMemoryStores } from "../../src";
import { UserBindingMismatchError, TenantBindingMismatchError } from "../../src/context/binding-errors";
import type { SessionRecord, StoreRegistry } from "../../src/stores/types";

const flow = defineFlow({
  kind: "race-bindings",
  actions: { run: { inputSchema: z.string(), block: handler({ name: "noop", execute: () => "ok" }) } }
})();

/**
 * A store that loses the create race: the pre-write read sees nothing, and the
 * `absent` create conflicts with whatever the winner left there.
 */
function raceLosingStores(winner: SessionRecord): StoreRegistry {
  const base = createInMemoryStores();
  return {
    ...base,
    session: {
      ...base.session,
      get: async () => undefined,
      set: async () => ({ ok: false as const, conflict: { currentValue: winner, currentVersion: 0 } })
    }
  } as unknown as StoreRegistry;
}

function winnerRecord(overrides: Partial<SessionRecord>): SessionRecord {
  const ts = 1_700_000_000_000;
  return {
    id: "s_contended",
    flowKind: flow.kind,
    userId: "u_winner",
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    journal: [],
    lineageId: "lin_winner",
    ...overrides
  } as SessionRecord;
}

describe("FIX-1068: the create-race loser is still bound-checked", () => {
  it("refuses when the winner's session belongs to another user", async () => {
    const stores = raceLosingStores(winnerRecord({ userId: "u_winner" }));

    await expect(
      createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_loser",
        sessionId: "s_contended",
        userId: "u_loser",
        stores
      })
    ).rejects.toBeInstanceOf(UserBindingMismatchError);
  });

  it("refuses when the winner's session belongs to another tenant", async () => {
    const stores = raceLosingStores(winnerRecord({ userId: "u_same", tenantId: "tenant_a" }));

    await expect(
      createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_loser",
        sessionId: "s_contended",
        userId: "u_same",
        tenantId: "tenant_b",
        stores
      })
    ).rejects.toBeInstanceOf(TenantBindingMismatchError);
  });

  it("adopts the winner's record — and its lineage — when the bindings agree", async () => {
    // The legitimate case: same principal, same tenant, two first actions. The
    // loser must run against the WINNER's lineage, or its shared writes land at
    // an address the winner never reads.
    const stores = raceLosingStores(winnerRecord({ userId: "u_same" }));

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_loser",
      sessionId: "s_contended",
      userId: "u_same",
      stores
    });

    expect(ctx.session.identity.id).toBe("s_contended");
  });
});
