/**
 * The dispatch seam's service route (FIX-2630 D1, Q1): a dispatch to an
 * internal entry its flow marks `service` doesn't start a request as its
 * sender. The host routes it as the service (`service:<provider>`) in the
 * sender's organization, and fires only the owner runs of the sender's own
 * user: a teammate's subscription and another org's hear nothing, however the
 * routing entry nominates them. The event's sender is the dispatching
 * session, stamped by the seam, whatever the payload said.
 *
 * Why these matter: a publish reaches subscribers without the publisher
 * naming them, so who may hear it is the host's call, never the routing
 * output's, and never the publishing block's.
 */
import { describe, expect, it, vi } from "vitest";
import { defineFlow, handler, markDispatcher } from "@flow-state-dev/core";
import { dispatchThroughSeam } from "@flow-state-dev/core/internal";
import type { DispatchOutcome } from "@flow-state-dev/core/types";
import { z } from "zod";
import { createFlowState, inMemoryStores, resolveUserStorageKey, runAction } from "../../src";

const ORG = "acme";

type Seen = { routedAs: string[]; routedSender: unknown[]; delivered: Array<{ as: string; note: string }> };

function boot() {
  const seen: Seen = { routedAs: [], routedSender: [], delivered: [] };
  const deliver = handler({
    name: "svc-deliver",
    inputSchema: z.object({ note: z.string() }),
    outputSchema: z.object({}),
    execute: async (input, ctx) => {
      seen.delivered.push({ as: (ctx.session.identity as { userId: string }).userId, note: input.note });
      return {};
    }
  });
  const route = handler({
    name: "svc-route",
    inputSchema: z.object({ sender: z.unknown(), runs: z.array(z.any()) }).passthrough(),
    outputSchema: z.object({ ownerRuns: z.array(z.any()) }),
    execute: async (input, ctx) => {
      seen.routedAs.push((ctx.session.identity as { userId: string }).userId);
      seen.routedSender.push(input.sender);
      return { ownerRuns: input.runs };
    }
  });
  const svc = defineFlow({
    kind: "svc",
    actions: {},
    internal: {
      actions: {
        deliver: { inputSchema: z.object({ note: z.string() }), block: deliver },
        route: { inputSchema: z.object({ sender: z.unknown(), runs: z.array(z.any()) }).passthrough(), block: route, service: { provider: "internal" } }
      }
    }
  })();
  const publish = handler({
    name: "publish",
    inputSchema: z.object({ runs: z.array(z.any()) }),
    outputSchema: z.object({ outcome: z.any() }),
    execute: async (input, ctx): Promise<{ outcome: DispatchOutcome }> => ({
      outcome: await dispatchThroughSeam(ctx, {
        type: "internal",
        action: "route",
        flowKind: "svc",
        session: { key: "publish" },
        // A sender the payload names is not the sender.
        payload: { sender: { id: "someone-else", name: "forged", role: "outsider" }, runs: input.runs },
        from: "publish"
      })
    })
  });
  markDispatcher(publish, { type: "internal", action: "route", flowKind: "svc" });
  const pub = defineFlow({ kind: "pub", actions: { publish: { inputSchema: z.object({ runs: z.array(z.any()) }), block: publish } } })();
  const stores = inMemoryStores();
  const state = createFlowState({ flows: { svc, pub }, stores: { default: { primary: stores } }, resolvePrincipal: () => null } as never);
  return { seen, state, pub };
}

const run = (userId: string, orgId: string, note: string) => ({ flowKind: "svc", entry: "deliver", input: { note }, owner: { userId, orgId }, rowKey: "subs/s1" });

describe("the dispatch seam's service route", () => {
  it("routes as the service in the sender's org, stamps the sender, and fires only the sender's own user's runs", async () => {
    const { seen, state, pub } = boot();
    try {
      const runtime = await state.getRuntime();
      for (const user of ["alice", "bob"]) {
        await runtime.stores.resourceState.set("user", resolveUserStorageKey(user, ORG, { id: "svc", isolateUserState: false }), "subs/s1", { orgId: ORG, enabled: true } as never, "any");
      }
      const result = (await runAction({
        orgId: ORG,
        flow: pub,
        actionName: "publish",
        input: { runs: [run("alice", ORG, "own"), run("bob", ORG, "teammate"), run("carol", "globex", "other org")] },
        userId: "alice",
        sessionId: "s_alice",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      })) as { output?: { outcome: DispatchOutcome } };
      expect(result.output?.outcome.ok).toBe(true);
      // Fired runs are accepted before the publish answers; wait for them to run.
      await vi.waitFor(() => expect(seen.delivered.length).toBeGreaterThan(0));
      expect(seen.routedAs).toEqual(["service:internal"]);
      expect(seen.routedSender).toEqual([{ id: "s_alice", name: "forged", role: "member" }]);
      expect(seen.delivered).toEqual([{ as: "alice", note: "own" }]);
    } finally {
      await state.dispose();
    }
  });
});
