/**
 * A run as a row's owner, fired host-side (FIX-2534 D2): the sibling of
 * `fireWakeThrough` that starts a request as the user whose cell holds a row.
 *
 * Why these matter: the owner and the cell come from whatever nominated the
 * run (a service flow's index), and a nomination grants nothing. The row must
 * be there, in that user's cell, name the same organization, and not be
 * switched off, by the schedule resolver's rule, or no request starts. The run
 * is that user's, so it reads that user's rows and nobody else's.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowState,
  fireOwnerRunThrough,
  inMemoryStores,
  resolveUserStorageKey,
  routeServiceEvent,
  type InboundTransportHost
} from "../../src";

const ORG = "acme";

const ownerRun = handler({
  name: "owner-run",
  inputSchema: z.object({ note: z.string() }),
  outputSchema: z.object({ ranAs: z.string(), note: z.string() }),
  execute: async (input, ctx) => ({ ranAs: (ctx.session.identity as { userId: string }).userId, note: input.note })
});

const route = handler({
  name: "service-route",
  inputSchema: z.object({ runs: z.array(z.any()) }),
  outputSchema: z.object({ ownerRuns: z.array(z.any()), ranAs: z.string() }),
  execute: async (input, ctx) => ({ ownerRuns: input.runs, ranAs: (ctx.session.identity as { userId: string }).userId })
});

const svc = defineFlow({
  kind: "svc",
  actions: {},
  internal: {
    actions: {
      deliver: { inputSchema: z.object({ note: z.string() }), block: ownerRun },
      route: { inputSchema: z.object({ runs: z.array(z.any()) }), block: route }
    }
  }
})();

async function boot() {
  let host: InboundTransportHost | undefined;
  const stores = inMemoryStores();
  const state = createFlowState({
    flows: { svc },
    stores: { default: { primary: stores } },
    resolvePrincipal: () => null,
    adapters: [{ source: "test", createBindings: (h: InboundTransportHost) => ((host = h), {}) }]
  } as never);
  await state.getRouter();
  const write = (userId: string, key: string, row: Record<string, unknown>) =>
    host!.stores.resourceState.set("user", resolveUserStorageKey(userId, ORG, { id: "svc", isolateUserState: false }), key, row as never, "any");
  return { host: host!, write, dispose: () => state.dispose() };
}

const run = (userId: string, rowKey: string, note = "hello") => ({
  flowKind: "svc",
  entry: "deliver",
  input: { note },
  owner: { userId, orgId: ORG },
  rowKey
});

describe("fireOwnerRunThrough", () => {
  it("runs the entry as the user whose cell holds a live row that names this org", async () => {
    const { host, write, dispose } = await boot();
    try {
      await write("alice", "subs/s1", { orgId: ORG, enabled: true });
      const fired = await fireOwnerRunThrough(host, run("alice", "subs/s1"));
      expect(fired.fired).toBe(true);
      const result = await (fired as { finished: Promise<{ output?: unknown }> }).finished;
      expect(result.output).toEqual({ ranAs: "alice", note: "hello" });
    } finally {
      await dispose();
    }
  });

  it("starts nothing for a row that isn't in that user's cell: a nomination grants nothing", async () => {
    const { host, write, dispose } = await boot();
    try {
      // Alice's row, nominated as bob's: bob's cell holds no such row.
      await write("alice", "subs/s1", { orgId: ORG, enabled: true });
      expect(await fireOwnerRunThrough(host, run("bob", "subs/s1"))).toEqual({ fired: false, refused: "no_row" });
    } finally {
      await dispose();
    }
  });

  it("starts nothing for a row naming another org, or one switched off", async () => {
    const { host, write, dispose } = await boot();
    try {
      await write("alice", "subs/other", { orgId: "globex", enabled: true });
      await write("alice", "subs/off", { orgId: ORG, enabled: false });
      await write("alice", "subs/none", { enabled: true });
      expect(await fireOwnerRunThrough(host, run("alice", "subs/other"))).toEqual({ fired: false, refused: "other_org" });
      expect(await fireOwnerRunThrough(host, run("alice", "subs/none"))).toEqual({ fired: false, refused: "other_org" });
      expect(await fireOwnerRunThrough(host, run("alice", "subs/off"))).toEqual({ fired: false, refused: "disabled" });
    } finally {
      await dispose();
    }
  });
});

describe("routeServiceEvent", () => {
  it("runs the service's entry as the service, then each owner run its output names, as that owner", async () => {
    const { host, write, dispose } = await boot();
    try {
      await write("alice", "subs/a", { orgId: ORG, enabled: true });
      const routed = await routeServiceEvent(host, {
        flowKind: "svc",
        entry: "route",
        principal: { userId: "service:github", orgId: ORG },
        input: { runs: [run("alice", "subs/a", "for alice"), run("bob", "subs/a", "for bob")] }
      });
      expect((routed.output as { ranAs: string }).ranAs).toBe("service:github");
      expect(routed.ownerRuns.map((o) => o.refused ?? "fired")).toEqual(["fired", "no_row"]);
      const outputs = await Promise.all(routed.ownerRuns.flatMap((o) => (o.finished === undefined ? [] : [o.finished])));
      expect(outputs.map((r) => r.output)).toEqual([{ ranAs: "alice", note: "for alice" }]);
    } finally {
      await dispose();
    }
  });
});
