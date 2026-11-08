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
  inMemoryStores,
  resolveUserStorageKey
} from "../../src";
import { fireOwnerRunThrough } from "../../src/durability/owner-runs";
import { routeServiceEvent } from "../../src/internal";
import { type InboundTransportHost } from "../../src/host";

const ORG = "acme";

const ownerRun = handler({
  name: "owner-run",
  inputSchema: z.object({ note: z.string() }),
  outputSchema: z.object({ ranAs: z.string(), tenant: z.string().optional(), note: z.string() }),
  execute: async (input, ctx) => {
    const identity = ctx.session.identity as { userId: string; tenantId?: string };
    return { ranAs: identity.userId, ...(identity.tenantId !== undefined ? { tenant: identity.tenantId } : {}), note: input.note };
  }
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
  const sessions = async () => (await host!.stores.session.list({})).length;
  return { host: host!, write, sessions, dispose: () => state.dispose() };
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
      expect(await fireOwnerRunThrough(host, run("bob", "subs/s1"))).toEqual({ fired: false, refused: "no_resource" });
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

  it("runs in the row's tenant, and starts nothing for a nomination naming another tenant than the row's", async () => {
    const { host, write, dispose } = await boot();
    try {
      await write("alice", "subs/t", { orgId: ORG, tenantId: "t1", enabled: true });
      const other = await fireOwnerRunThrough(host, { ...run("alice", "subs/t"), owner: { userId: "alice", orgId: ORG, tenantId: "t2" } });
      expect(other).toEqual({ fired: false, refused: "other_tenant" });
      // No tenant on the nomination is not the row's tenant either.
      expect(await fireOwnerRunThrough(host, run("alice", "subs/t"))).toEqual({ fired: false, refused: "other_tenant" });
      const fired = await fireOwnerRunThrough(host, { ...run("alice", "subs/t", "tenanted"), owner: { userId: "alice", orgId: ORG, tenantId: "t1" } });
      expect(fired.fired).toBe(true);
      const result = await (fired as { finished: Promise<{ output?: unknown }> }).finished;
      expect(result.output).toEqual({ ranAs: "alice", tenant: "t1", note: "tenanted" });
    } finally {
      await dispose();
    }
  });

  it("starts every run of one row in one session, so a busy row stores one session and not one per run", async () => {
    const { host, write, sessions, dispose } = await boot();
    try {
      await write("alice", "subs/s1", { orgId: ORG, enabled: true });
      const before = await sessions();
      for (const note of ["one", "two", "three"]) {
        const fired = await fireOwnerRunThrough(host, run("alice", "subs/s1", note));
        await (fired as { finished: Promise<unknown> }).finished;
      }
      expect((await sessions()) - before).toBe(1);
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
      expect(routed.ownerRuns.map((o) => o.refused ?? "fired")).toEqual(["fired", "no_resource"]);
      const outputs = await Promise.all(routed.ownerRuns.flatMap((o) => (o.finished === undefined ? [] : [o.finished])));
      expect(outputs.map((r) => r.output)).toEqual([{ ranAs: "alice", note: "for alice" }]);
    } finally {
      await dispose();
    }
  });

  it("fires the other runs when one fails to start, and records that one's failure", async () => {
    const { host, write, dispose } = await boot();
    try {
      for (const user of ["alice", "bob", "carol"]) await write(user, "subs/a", { orgId: ORG, enabled: true });
      const failing: InboundTransportHost = {
        ...host,
        dispatch: (envelope) => {
          if (envelope.principal.userId === "bob") throw new Error("the host is full");
          return host.dispatch(envelope);
        }
      };
      const routed = await routeServiceEvent(failing, {
        flowKind: "svc",
        entry: "route",
        principal: { userId: "service:github", orgId: ORG },
        input: { runs: ["alice", "bob", "carol"].map((user) => run(user, "subs/a", `for ${user}`)) }
      });
      expect(routed.ownerRuns.map((o) => o.failed ?? o.refused ?? "fired")).toEqual(["fired", "the host is full", "fired"]);
      const outputs = await Promise.all(routed.ownerRuns.flatMap((o) => (o.finished === undefined ? [] : [o.finished])));
      expect(outputs.map((r) => (r.output as { note: string }).note)).toEqual(["for alice", "for carol"]);
    } finally {
      await dispose();
    }
  });

  it("reads the service's output at the fence: a run of another flow, or of an owner in another org, fires nothing", async () => {
    const { host, write, dispose } = await boot();
    try {
      await write("alice", "subs/a", { orgId: ORG, enabled: true });
      const routed = await routeServiceEvent(host, {
        flowKind: "svc",
        entry: "route",
        principal: { userId: "service:github", orgId: ORG },
        input: {
          runs: [
            { ...run("alice", "subs/a"), flowKind: "admin" },
            { ...run("alice", "subs/a"), owner: { userId: "alice", orgId: "globex" } },
            "not a run",
            run("alice", "subs/a", "the one good run")
          ]
        }
      });
      expect(routed.malformed.map((m) => m.reason)).toEqual([
        'names flow "admin", not the service\'s own "svc"',
        "names an owner in another org",
        "not an object"
      ]);
      expect(routed.ownerRuns).toHaveLength(1);
      expect(((await routed.ownerRuns[0]!.finished!).output as { note: string }).note).toBe("the one good run");
    } finally {
      await dispose();
    }
  });
});
