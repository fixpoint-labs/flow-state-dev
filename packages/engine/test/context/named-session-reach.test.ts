/**
 * A block reaching another of its owner's sessions by naming it:
 * `ctx.resources.at({ session }).<name>`, on the real path (`runAction` →
 * `createExecutionContext` → the block).
 *
 * Why these matter: a worker that settles its task on the conversation that
 * filed it needs that conversation's copy, read and written as the copy's own
 * session would. The reach must answer a session that isn't the caller's
 * owner's exactly as an id nobody holds, on every verb, or a caller learns
 * which ids exist; and a write must be heard by the session written, never
 * leak onto a topic the caller hears.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, defineResource, defineResourceCollection, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowRegistry, defaultBodyUserIdPrincipalResolver, runAction } from "../../src";
import { createInboundTransportHost, createInMemoryBus, createInMemoryStores } from "../../src/host";
import { dispatchInternalAs } from "../../src/durability/dispatch-internal";
import { fireWakeThrough } from "../../src/durability/request-wakes";
import type { StoreRegistry } from "../../src/stores/types";

const ORG = "acme";

/** A single resource: its state is read synchronously, so it can't wait on another session's admission. */
const prefs = defineResource({ scope: "session", stateSchema: z.object({ theme: z.string().default("light") }) });
const notes = defineResourceCollection({
  pattern: "notes/*",
  scope: "session",
  stateSchema: z.object({ text: z.string() }),
  client: {}
});

/** Each `reactTo` run of the inbox, by the session it ran in. */
const reacted: string[] = [];
const react = handler({
  name: "react",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: async (_change, ctx) => {
    reacted.push(ctx.session.identity.id);
    return null;
  }
});
/** An inbox whose writes from another session start a turn of `inboxChanged`. */
const inbox = defineResourceCollection({
  pattern: "inbox/*",
  scope: "session",
  stateSchema: z.object({ text: z.string() }),
  wakeEntry: "inboxChanged",
  reactTo: { created: react }
});
/** Each turn `inboxChanged` ran, with the resolver identity it ran under. */
const woken: Array<{ session: string; rows: number }> = [];
const inboxChanged = handler({
  name: "inbox-changed",
  inputSchema: z.object({}).passthrough(),
  outputSchema: z.object({}),
  execute: async (_input, ctx) => {
    const rows = await (ctx.resources as any).inbox.list();
    woken.push({ session: ctx.session.identity.id, rows: rows.length });
    return {};
  }
});

type Op = (ctx: any) => Promise<unknown>;
let op: Op = async () => null;
/** What the last `reach` got back. */
let lastOut: unknown;

const seed = handler({
  name: "seed",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({}),
  execute: async ({ text }, ctx) => {
    await (ctx.resources as any).notes.create("n1", { text });
    return {};
  }
});
const reach = handler({
  name: "reach",
  inputSchema: z.object({}),
  outputSchema: z.object({ out: z.unknown() }),
  execute: async (_input, ctx) => {
    try {
      lastOut = { ok: await op(ctx) };
    } catch (error) {
      lastOut = { error: (error as Error).message, name: (error as Error).name };
    }
    return { out: lastOut };
  }
});

const flowA = defineFlow({ kind: "alpha", actions: { seed, reach }, internal: { actions: { reach: { block: reach } } }, resources: { notes, inbox, prefs } })();
const flowB = defineFlow({
  kind: "beta",
  actions: { seed, reach },
  internal: { actions: { inboxChanged: { block: inboxChanged } } },
  resources: { notes, inbox }
})();

async function boot() {
  const registry = createFlowRegistry();
  registry.register(flowA);
  registry.register(flowB);
  const stores: StoreRegistry = { ...createInMemoryStores(), bus: createInMemoryBus() };
  const runtimeConfig = { requestHost: { flows: registry, wakes: { maxDebtAgeMs: 86_400_000 } } };
  const as = (userId: string, orgId = ORG) => ({ userId, orgId, principalKind: "person" as const, source: "http" });
  const seedIn = async (flow: typeof flowA | typeof flowB, sessionId: string, text: string, who = as("alice")) => {
    const result = await runAction({ flow, actionName: "seed", input: { text }, sessionId, stores, runtimeConfig, ...who });
    expect(result.error).toBeUndefined();
  };
  /** Run `fn` as a block in alice's session `a` and return what it got back. */
  const reachFrom = async (fn: Op, extra: Record<string, unknown> = {}) => {
    op = fn;
    const result = await runAction({
      flow: flowA,
      actionName: "reach",
      input: {},
      sessionId: "a",
      stores,
      runtimeConfig,
      ...as("alice"),
      ...extra
    });
    expect(result.error).toBeUndefined();
    return (result.output as { out: unknown }).out;
  };
  /** Every resource notice on `sessionId`'s topic, as the bus delivers it. */
  const hear = (sessionId: string) => {
    const heard: unknown[] = [];
    stores.bus!.subscribe({ scope: "session", id: sessionId, tenantId: "" }, (notice) => {
      if (notice.kind === "resource") heard.push(notice);
    });
    return heard;
  };
  /**
   * Run `fn` in alice's session `a` as a run a webhook delivery fired: an
   * internal dispatch the engine stamps with the delivery's origin, as a
   * service delivery's owner run is.
   */
  const reachFromDelivery = async (fn: Op) => {
    op = fn;
    lastOut = undefined;
    const host = createInboundTransportHost({ registry, stores, resolvePrincipal: defaultBodyUserIdPrincipalResolver, runtimeConfig });
    const handle = dispatchInternalAs(host, {
      flowKind: "alpha",
      entry: "reach",
      input: {},
      as: { userId: "alice", orgId: ORG, kind: "person" },
      sessionId: "a",
      metadata: {},
      origin: "webhook"
    });
    await handle.finished;
    return lastOut;
  };
  /** Fire every wake due by `at`, as the sweeper does; resolves once each turn ran. */
  const fireDue = async (at: number) => {
    const host = createInboundTransportHost({ registry, stores, resolvePrincipal: defaultBodyUserIdPrincipalResolver, runtimeConfig });
    const runs: Promise<unknown>[] = [];
    for (const wake of await stores.wakes!.listDue(at, 100)) {
      await fireWakeThrough(host, wake, (run) => runs.push(run.finished));
    }
    await Promise.all(runs);
  };
  return { stores, seedIn, reachFrom, reachFromDelivery, as, hear, fireDue };
}

const texts = (rows: Array<{ state: { text: string } }>) => rows.map((row) => row.state.text).sort();

describe("ctx.resources.at({ session })", () => {
  it("reads, lists and writes the named session's copy, with the calling flow's definition", async () => {
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    await env.seedIn(flowB, "b", "theirs");

    const listed = await env.reachFrom(async (ctx) => texts(await ctx.resources.at({ session: "b" }).notes.list()));
    expect(listed).toEqual({ ok: ["theirs"] });

    await env.reachFrom(async (ctx) => {
      await ctx.resources.at({ session: "b" }).notes.create("n2", { text: "written from a" });
      return null;
    });
    // B's own run sees the write; A's own copy is untouched.
    const own = await env.reachFrom(async (ctx) => texts(await ctx.resources.notes.list()));
    expect(own).toEqual({ ok: ["mine"] });
    const theirs = await env.reachFrom(async (ctx) => {
      const ref = await ctx.resources.at({ session: "b" }).notes.get("n2");
      return ref.state.text;
    });
    expect(theirs).toEqual({ ok: "written from a" });
  });

  it("answers another owner's session exactly as an id nobody holds, on every verb, and writes nothing there", async () => {
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    await env.seedIn(flowB, "bob-s", "bob's", env.as("bob"));
    await env.seedIn(flowB, "other-org", "elsewhere", env.as("alice", "globex"));
    const verbs: Record<string, (s: string) => Op> = {
      list: (s) => async (ctx) => ctx.resources.at({ session: s }).notes.list(),
      get: (s) => async (ctx) => ctx.resources.at({ session: s }).notes.get("n1"),
      getOptional: (s) => async (ctx) => ctx.resources.at({ session: s }).notes.getOptional("n1"),
      count: (s) => async (ctx) => ctx.resources.at({ session: s }).notes.count(),
      create: (s) => async (ctx) => ctx.resources.at({ session: s }).notes.create("x", { text: "intruder" }),
      upsert: (s) => async (ctx) => ctx.resources.at({ session: s }).notes.upsert("n1", { text: "intruder" }),
      delete: (s) => async (ctx) => ctx.resources.at({ session: s }).notes.delete("n1")
    };
    for (const [verb, call] of Object.entries(verbs)) {
      const unknown = JSON.stringify(await env.reachFrom(call("an-id-nobody-holds")));
      expect(unknown, verb).toContain("SessionNotFoundError");
      for (const refused of ["bob-s", "other-org"]) {
        expect(JSON.stringify(await env.reachFrom(call(refused))), `${verb} on ${refused}`).toBe(unknown);
      }
    }
    // Nothing landed in either: their owners still read only their own note.
    const bobs = await env.stores.resourceState.getByPrefix("session", "bob-s", "notes/");
    expect(Object.keys(bobs)).toEqual(["notes/n1"]);
    expect((bobs["notes/n1"]!.state as { text: string }).text).toBe("bob's");
  });

  it("a write into the named session is heard on that session's topic, once per write, and never on the caller's", async () => {
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    await env.seedIn(flowB, "b", "theirs");
    const onB = env.hear("b");
    const onA = env.hear("a");
    await env.reachFrom(async (ctx) => {
      const theirs = ctx.resources.at({ session: "b" }).notes;
      await theirs.create("n2", { text: "one" });
      await theirs.upsert("n2", { text: "two" });
      await theirs.delete("n2");
      return null;
    });
    expect(onB).toHaveLength(3);
    expect(onA).toHaveLength(0);
  });

  // A webhook turn reads text a stranger wrote: if it could name a session,
  // the text could choose which conversation is read or changed.
  it("a turn a webhook delivery started is refused on every verb, naming the rule, not the session", async () => {
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    await env.seedIn(flowB, "b", "theirs");
    const refusals = new Set<string>();
    for (const call of [
      async (ctx: any) => ctx.resources.at({ session: "b" }).notes.list(),
      async (ctx: any) => ctx.resources.at({ session: "b" }).notes.getOptional("n1"),
      async (ctx: any) => ctx.resources.at({ session: "b" }).notes.create("x", { text: "steered" }),
      async (ctx: any) => ctx.resources.at({ session: "an-id-nobody-holds" }).notes.list()
    ]) {
      const got = (await env.reachFromDelivery(call)) as { error?: string; name?: string };
      expect(got.name).toBe("UntrustedReachError");
      refusals.add(got.error!);
    }
    // One refusal for every verb and target: it names the rule, never the session.
    expect([...refusals]).toEqual(["A turn a webhook delivery started reaches no session but its own."]);
    // Its own session is still its own.
    expect(await env.reachFromDelivery(async (ctx) => texts(await ctx.resources.at({ session: "a" }).notes.list()))).toEqual({ ok: ["mine"] });
    const bs = await env.stores.resourceState.getByPrefix("session", "b", "notes/");
    expect(Object.keys(bs)).toEqual(["notes/n1"]);
  });

  // A burst of fifty endings must not start fifty turns of the filer.
  it("a burst of writes into another session starts one turn of its entry there, as a wake, never its reactTo inline", async () => {
    reacted.length = 0;
    woken.length = 0;
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    await env.seedIn(flowB, "b", "theirs");
    await env.reachFrom(
      async (ctx) => {
        const theirs = ctx.resources.at({ session: "b" }).inbox;
        for (let i = 0; i < 20; i += 1) await theirs.create(`m${i}`, { text: `ending ${i}` });
        return null;
      },
      { resolvedBy: "host:test" }
    );
    // Nothing of B's ran inside A's turn.
    expect(reacted).toEqual([]);
    // One wake, on B's entry, carrying the writer's resolver identity.
    const due = await env.stores.wakes!.listDue(Number.MAX_SAFE_INTEGER, 100);
    expect(due.map((w) => [w.sessionId, w.entry, w.resolvedBy])).toEqual([["b", "inboxChanged", "host:test"]]);
    await env.fireDue(Number.MAX_SAFE_INTEGER);
    expect(woken).toEqual([{ session: "b", rows: 20 }]);
  });

  it("naming the run's own session is its own copy: one cache, its reactTo, no wake", async () => {
    reacted.length = 0;
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    const seen = await env.reachFrom(async (ctx) => {
      await ctx.resources.at({ session: "a" }).inbox.create("m1", { text: "own" });
      // The run's own handle sees the write at once, from the same cache.
      return (await ctx.resources.inbox.getOptional("m1"))?.state.text ?? null;
    });
    expect(seen).toEqual({ ok: "own" });
    expect(reacted).toEqual(["a"]);
    expect(await env.stores.wakes!.listDue(Number.MAX_SAFE_INTEGER, 100)).toEqual([]);
  });

  it("a session's own writes start no wake: its reactTo answers them, as before", async () => {
    reacted.length = 0;
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    await env.reachFrom(async (ctx) => (await ctx.resources.inbox.create("m1", { text: "own" })).state.text);
    expect(reacted).toEqual(["a"]);
    expect(await env.stores.wakes!.listDue(Number.MAX_SAFE_INTEGER, 100)).toEqual([]);
  });

  it("a single resource can't be reached in another session: naming one throws, by property or by name", async () => {
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    await env.seedIn(flowB, "b", "theirs");
    const byProperty = (await env.reachFrom(async (ctx) => ctx.resources.at({ session: "b" }).prefs.state)) as { error?: string };
    const byName = (await env.reachFrom(async (ctx) => ctx.resources.at({ session: "b" }).get("prefs").state)) as { error?: string };
    expect(byProperty.error).toContain("can't be reached in another session");
    expect(byName.error).toBe(byProperty.error);
  });
});
