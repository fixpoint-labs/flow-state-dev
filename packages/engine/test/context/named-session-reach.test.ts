/**
 * A block reaching another of its owner's sessions by naming it:
 * `ctx.resources.at({ session }).<name>`, on the real path (`runAction` →
 * `createExecutionContext` → the block).
 *
 * Why these matter: a worker that settles its task on the conversation that
 * filed it needs that conversation's resources, read and written as that
 * session's own run would. The reach must answer a session that isn't the caller's
 * owner's exactly as an id nobody holds, on every verb, or a caller learns
 * which ids exist; and a write must be heard by the session written, never
 * leak onto a topic the caller hears.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow, defineResource, defineResourceCollection, handler } from "@flow-state-dev/core";
import { requireRequestHost } from "@flow-state-dev/core/internal";
import { z } from "zod";
import { createFlowRegistry, defaultBodyUserIdPrincipalResolver, runAction } from "../../src";
import { createInboundTransportHost, createInMemoryBus, createInMemoryStores, type PrincipalResolver } from "../../src/host";
import { dispatchInternalAs } from "../../src/durability/dispatch-internal";
import { fireWakeThrough } from "../../src/durability/request-wakes";
import { principalResolverIdentity } from "../../src/transports/auth/pickPrincipalResolver";
import { birthSession } from "../../src/context/session-birth";
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
type Op = (ctx: any) => Promise<unknown>;
/** Each turn `inboxChanged` ran: its session, how many rows it read, and how its settle of the wake came out. */
const woken: Array<{ session: string; entries: number; settled?: string }> = [];
/** What a woken turn does around its wake read: `before` runs first, `reach` right after, its answer kept in `wokenReach`. */
const wokenHooks: { before?: () => Promise<void>; reach?: Op } = {};
let wokenReach: unknown;
/** Every woken turn's `reach` answer, in the order the turns ran. */
const wokenReaches: unknown[] = [];
const inboxChanged = handler({
  name: "inbox-changed",
  inputSchema: z.object({}).passthrough(),
  outputSchema: z.object({}),
  execute: async (_input, ctx) => {
    const wakes = requireRequestHost(ctx).wakes;
    await wokenHooks.before?.();
    const read = await wakes?.read("inboxChanged");
    if (wokenHooks.reach !== undefined) {
      try {
        wokenReach = { ok: await wokenHooks.reach(ctx) };
      } catch (error) {
        wokenReach = { error: (error as Error).message, name: (error as Error).name };
      }
      wokenReaches.push(wokenReach);
    }
    const entries = await (ctx.resources as any).inbox.list();
    const settled = wakes !== undefined && read !== undefined ? await wakes.settle("inboxChanged", read, null) : undefined;
    woken.push({ session: ctx.session.identity.id, entries: entries.length, ...(settled !== undefined ? { settled } : {}) });
    return {};
  }
});

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

/** A flow that resolves its callers with a resolver of its own: only a principal that resolver produced reaches its sessions. */
const vaultResolver: PrincipalResolver = async () => ({ userId: "alice", orgId: ORG });
const vault = defineFlow({ kind: "vault", actions: { seed }, resources: { notes }, authentication: { resolvePrincipal: vaultResolver } })();

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
  registry.register(vault);
  const stores: StoreRegistry = { ...createInMemoryStores(), bus: createInMemoryBus() };
  const runtimeConfig = {
    requestHost: { flows: registry, wakes: { maxDebtAgeMs: 86_400_000 } },
    hostResolver: defaultBodyUserIdPrincipalResolver
  };
  const as = (userId: string, orgId = ORG) => ({ userId, orgId, principalKind: "person" as const, source: "http" });
  const seedIn = async (flow: typeof flowA | typeof flowB | typeof vault, sessionId: string, text: string, who = as("alice")) => {
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
  return { stores, registry, seedIn, reachFrom, reachFromDelivery, as, hear, fireDue };
}

afterEach(() => {
  delete wokenHooks.before;
  delete wokenHooks.reach;
  wokenReach = undefined;
  wokenReaches.length = 0;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const texts = (entries: Array<{ state: { text: string } }>) => entries.map((entry) => entry.state.text).sort();

describe("ctx.resources.at({ session })", () => {
  it("reads, lists and writes the named session's notes, with the calling flow's definition", async () => {
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    await env.seedIn(flowB, "b", "theirs");

    const listed = await env.reachFrom(async (ctx) => texts(await ctx.resources.at({ session: "b" }).notes.list()));
    expect(listed).toEqual({ ok: ["theirs"] });

    await env.reachFrom(async (ctx) => {
      await ctx.resources.at({ session: "b" }).notes.create("n2", { text: "written from a" });
      return null;
    });
    // B's own run sees the write; A's own notes are untouched.
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
    expect(woken.map(({ session, entries }) => ({ session, entries }))).toEqual([{ session: "b", entries: 20 }]);
    // Owed before the writes, the wake is fenced by the writing request's
    // lease: a turn before then holds it there, for one more, empty turn.
    expect(woken[0]?.settled).toBe("moved");
  });

  it("naming the run's own session reaches its own resources: one cache, its reactTo, no wake", async () => {
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

  // The turn is owed before the write: a write that lands always has its turn,
  // and one whose turn can't be owed never lands.
  it("owes the turn before the write: when the owe fails, nothing is written and the write rejects", async () => {
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    await env.seedIn(flowB, "b", "theirs");
    vi.spyOn(env.stores.wakes!, "owe").mockRejectedValueOnce(new Error("wake store down"));
    const got = await env.reachFrom(async (ctx) => (await ctx.resources.at({ session: "b" }).inbox.create("m1", { text: "lost?" })).state.text);
    expect(got).toMatchObject({ error: "wake store down" });
    expect(await env.stores.resourceState.getByPrefix("session", "b", "inbox/")).toEqual({});
    expect(await env.stores.wakes!.listDue(Number.MAX_SAFE_INTEGER, 100)).toEqual([]);
  });

  // A process that dies between the owe and the write leaves the debt behind:
  // its turn runs, reads that nothing changed, and settles.
  it("a write that dies after its owe still yields a turn there, which finds nothing new and settles", async () => {
    woken.length = 0;
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    await env.seedIn(flowB, "b", "theirs");
    const set = env.stores.resourceState.set.bind(env.stores.resourceState);
    vi.spyOn(env.stores.resourceState, "set").mockImplementation((async (...args: Parameters<typeof set>) => {
      if (String(args[2]).startsWith("inbox/")) throw new Error("process died");
      return set(...args);
    }) as typeof set);
    const got = await env.reachFrom(async (ctx) => (await ctx.resources.at({ session: "b" }).inbox.create("m1", { text: "never lands" })).state.text);
    expect(got).toMatchObject({ error: "process died" });
    vi.mocked(env.stores.resourceState.set).mockRestore();
    expect(await env.stores.resourceState.getByPrefix("session", "b", "inbox/")).toEqual({});

    const [owed] = await env.stores.wakes!.listDue(Number.MAX_SAFE_INTEGER, 100);
    expect([owed?.sessionId, owed?.entry]).toEqual(["b", "inboxChanged"]);
    // Fired before the fence, the turn reads nothing new and holds the wake at
    // the fence, in case the write were still landing.
    await env.fireDue(Number.MAX_SAFE_INTEGER);
    expect(woken).toEqual([{ session: "b", entries: 0, settled: "moved" }]);
    // Past the fence, that one extra turn reads nothing new and clears it.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(owed!.landBy + 1);
    await env.fireDue(Number.MAX_SAFE_INTEGER);
    expect(woken.at(-1)).toEqual({ session: "b", entries: 0, settled: "cleared" });
    expect(await env.stores.wakes!.listDue(Number.MAX_SAFE_INTEGER, 100)).toEqual([]);
  });

  it("an update and a delete into another session each owe its turn, as a create does", async () => {
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    await env.seedIn(flowB, "b", "theirs");
    const owedNow = async () => {
      const due = await env.stores.wakes!.listDue(Number.MAX_SAFE_INTEGER, 100);
      for (const wake of due) await env.stores.wakes!.clear(wake, wake.version);
      return due.map((wake) => [wake.sessionId, wake.entry]);
    };
    await env.reachFrom(async (ctx) => (await ctx.resources.at({ session: "b" }).inbox.create("m1", { text: "one" })).state.text);
    expect(await owedNow()).toEqual([["b", "inboxChanged"]]);
    await env.reachFrom(async (ctx) => (await ctx.resources.at({ session: "b" }).inbox.upsert("m1", { text: "two" })).state.text);
    expect(await owedNow()).toEqual([["b", "inboxChanged"]]);
    await env.reachFrom(async (ctx) => (await ctx.resources.at({ session: "b" }).inbox.delete("m1")) ?? null);
    expect(await owedNow()).toEqual([["b", "inboxChanged"]]);
    expect(await env.stores.resourceState.getByPrefix("session", "b", "inbox/")).toEqual({});
  });

  // A delete of an entry with content removes two rows. One debt, owed before
  // either, covers both: a second owe that failed between them would leave
  // the content of an entry whose state is gone, and its delete half done.
  it("an owe failure on a collection entry that has content deletes neither its state nor its content, and the delete rejects cleanly", async () => {
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    await env.seedIn(flowB, "b", "theirs");
    await env.reachFrom(async (ctx) => {
      const theirs = ctx.resources.at({ session: "b" }).inbox;
      await (await theirs.create("m1", { text: "with content" })).writeContent("the body");
      return null;
    });
    const stored = async () => ({
      state: Object.keys(await env.stores.resourceState.getByPrefix("session", "b", "inbox/")),
      content: Object.keys(await env.stores.content.getByPrefix("session", "b", "inbox/"))
    });
    expect(await stored()).toEqual({ state: ["inbox/m1"], content: ["inbox/m1"] });
    const deleteM1 = () =>
      env.reachFrom(async (ctx) => {
        const theirs = ctx.resources.at({ session: "b" }).inbox;
        await theirs.get("m1");
        return (await theirs.delete("m1")) ?? null;
      });
    const owe = env.stores.wakes!.owe.bind(env.stores.wakes!);
    const spy = vi.spyOn(env.stores.wakes!, "owe");

    // The delete's one owe fails: nothing is deleted, and the delete rejects.
    spy.mockRejectedValue(new Error("wake store down"));
    expect(await deleteM1()).toMatchObject({ error: "wake store down" });
    expect(await stored()).toEqual({ state: ["inbox/m1"], content: ["inbox/m1"] });

    // Any owe after the first fails: the first covers both halves, so the
    // delete lands whole, never half.
    spy.mockReset();
    spy.mockImplementationOnce(owe).mockRejectedValue(new Error("wake store down"));
    expect(await deleteM1()).toEqual({ ok: null });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await stored()).toEqual({ state: [], content: [] });
  });

  // A turn owed on an entry the target's flow doesn't declare can never run,
  // and the sweeper would retry it forever.
  it("refuses a write into a session whose flow doesn't declare the wake entry, owing nothing and writing nothing", async () => {
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    await env.seedIn(flowA, "a2", "also alpha");
    const got = (await env.reachFrom(async (ctx) => (await ctx.resources.at({ session: "a2" }).inbox.create("m1", { text: "unpayable" })).state.text)) as {
      error?: string;
    };
    expect(got.error).toContain('"inboxChanged"');
    expect(got.error).toContain("declares no internal entry");
    expect(await env.stores.resourceState.getByPrefix("session", "a2", "inbox/")).toEqual({});
    expect(await env.stores.wakes!.listDue(Number.MAX_SAFE_INTEGER, 100)).toEqual([]);
  });

  // A session id deleted and taken again is another session: the admission
  // the first one earned must not carry over to it.
  it("a session deleted and recreated under another owner mid-run is refused through the cached admission, and nothing is written", async () => {
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    await env.seedIn(flowB, "b", "theirs");
    const unknown = await env.reachFrom(async (ctx) => (await ctx.resources.at({ session: "an-id-nobody-holds" }).notes.create("x", { text: "y" })).state.text);
    const got = await env.reachFrom(async (ctx) => {
      const theirs = ctx.resources.at({ session: "b" }).notes;
      expect(texts(await theirs.list())).toEqual(["theirs"]);
      const before = (await env.stores.session.get("b"))!;
      await env.stores.session.delete("b");
      await env.stores.session.set(
        "b",
        { ...before, userId: "bob", createdAt: before.createdAt + 1, updatedAt: before.createdAt + 1, version: 0, lineageId: "lin_reborn" },
        "absent"
      );
      return (await theirs.create("x", { text: "through the old admission" })).state.text;
    });
    expect(got).toEqual(unknown);
    expect(Object.keys(await env.stores.resourceState.getByPrefix("session", "b", "notes/"))).toEqual(["notes/n1"]);
  });

  // A birth's time has millisecond resolution and a child's lineage can be
  // derived, so a session deleted and born again in the same millisecond can
  // match the old record on everything but its per-birth token. That rebirth
  // is still another session, and must be admitted again from scratch.
  it("a session deleted and born again in the same millisecond, with the same lineage and owner, is refused through the cached admission, and nothing is written", async () => {
    const env = await boot();
    await env.seedIn(flowA, "a", "mine");
    await env.seedIn(flowB, "b", "theirs");
    const unknown = await env.reachFrom(async (ctx) => (await ctx.resources.at({ session: "an-id-nobody-holds" }).notes.create("x", { text: "y" })).state.text);
    const got = await env.reachFrom(async (ctx) => {
      const theirs = ctx.resources.at({ session: "b" }).notes;
      expect(texts(await theirs.list())).toEqual(["theirs"]);
      const before = (await env.stores.session.get("b"))!;
      await env.stores.session.delete("b");
      // Born again through the one birth path, at the same millisecond and
      // into the same lineage and owner, now as a session of the vault, whose
      // own resolver didn't produce this run's principal.
      const { born } = await birthSession(
        env.stores,
        "b",
        { flow: vault, sessionId: "b", principal: { userId: "alice", orgId: ORG }, fromCaller: false, via: "dispatch", principalKind: "person" },
        () => ({ ...before, flowKind: "vault", flowId: "vault", version: 0, journal: [] })
      );
      expect(born).toBe(true);
      const reborn = (await env.stores.session.get("b"))!;
      expect([reborn.createdAt, reborn.lineageId, reborn.userId]).toEqual([before.createdAt, before.lineageId, before.userId]);
      return (await theirs.create("x", { text: "through the old admission" })).state.text;
    });
    expect(got).toEqual(unknown);
    expect(Object.keys(await env.stores.resourceState.getByPrefix("session", "b", "notes/"))).toEqual(["notes/n1"]);
  });

  // A wake is kept per resolver identity, and the turn it fires holds that
  // row's resolver for the whole turn: only that resolver's writers owe the
  // row, so nothing that happens to the session's other wakes, or to this
  // one, while the turn runs can change what it may reach.
  describe("a woken turn's resolver identity is its wake row's", () => {
    type Env = Awaited<ReturnType<typeof boot>>;
    const vaultIdentityOf = (env: Env) => principalResolverIdentity(env.registry, "vault", defaultBodyUserIdPrincipalResolver)!;
    /** Write into b's inbox from a under `resolvedBy` (none when `undefined`). */
    const writeIntoB = (env: Env, id: string, resolvedBy: string | undefined) =>
      env.reachFrom(
        async (ctx) => (await ctx.resources.at({ session: "b" }).inbox.create(id, { text: "from a" })).state.text,
        resolvedBy !== undefined ? { resolvedBy } : {}
      );
    const reachVault: Op = async (ctx) => texts(await ctx.resources.at({ session: "v" }).notes.list());
    async function booted(): Promise<Env> {
      woken.length = 0;
      const env = await boot();
      await env.seedIn(flowA, "a", "mine");
      await env.seedIn(flowB, "b", "theirs");
      await env.seedIn(vault, "v", "vaulted");
      return env;
    }
    /** Write into b's inbox from a, as a principal the vault's resolver produced; then fire b's wake. */
    async function wokenUnderVault(before?: (env: Env) => Promise<void>, reachWith: (env: Env) => Op = () => reachVault): Promise<Env> {
      const env = await booted();
      await writeIntoB(env, "m1", vaultIdentityOf(env));
      if (before !== undefined) wokenHooks.before = () => before(env);
      wokenHooks.reach = reachWith(env);
      await env.fireDue(Number.MAX_SAFE_INTEGER);
      return env;
    }
    /** Owe on b's inbox entry as a writer under `resolvedBy` would, straight into the store. */
    const oweIntoB = (env: Env, resolvedBy: string) =>
      env.stores.wakes!.owe({ sessionId: "b", entry: "inboxChanged", flowKind: "beta", userId: "alice", orgId: ORG, dueAt: Date.now(), landBy: Date.now(), resolvedBy });
    const keptWakes = async (env: Env) =>
      (await env.stores.wakes!.listDue(Number.MAX_SAFE_INTEGER, 100)).map((wake) => [wake.sessionId, wake.entry, wake.resolvedBy ?? null, wake.version]);

    it("reaches what its writers' resolver admits", async () => {
      await wokenUnderVault();
      expect(wokenReach).toEqual({ ok: ["vaulted"] });
    });

    it("two resolvers' writes into one session and entry keep two wakes and start two turns, each under its own resolver", async () => {
      const env = await booted();
      await writeIntoB(env, "m1", vaultIdentityOf(env));
      await writeIntoB(env, "m2", undefined);
      await writeIntoB(env, "m3", vaultIdentityOf(env));
      expect((await keptWakes(env)).map(([, , resolvedBy]) => resolvedBy).sort()).toEqual([null, vaultIdentityOf(env)].sort());
      wokenHooks.reach = reachVault;
      await env.fireDue(Number.MAX_SAFE_INTEGER);
      expect(woken.map((turn) => turn.session)).toEqual(["b", "b"]);
      // The vault's turn reaches the vault's session; the other turn, under no resolver, can't.
      expect(wokenReaches).toHaveLength(2);
      expect(wokenReaches).toContainEqual({ ok: ["vaulted"] });
      expect(wokenReaches).toContainEqual(expect.objectContaining({ name: "SessionNotFoundError" }));
    });

    // A turn delayed past its row's clear and re-owe reads its own resolver's
    // row again, which only that resolver's writers can owe.
    it("a delayed turn whose row was cleared and re-owed by its own resolver reaches only what it could before; another resolver's owe is a row of its own", async () => {
      let vaultIdentity = "";
      const env = await wokenUnderVault(async (env) => {
        vaultIdentity = vaultIdentityOf(env);
        const [kept] = await env.stores.wakes!.listDue(Number.MAX_SAFE_INTEGER, 10);
        expect(await env.stores.wakes!.clear(kept!, kept!.version)).toBe(true);
        await oweIntoB(env, vaultIdentity);
        await oweIntoB(env, "another resolver");
      });
      expect(wokenReach).toEqual({ ok: ["vaulted"] });
      // The turn settled its own row; the other resolver's is untouched, to fire its own turn.
      expect(woken.at(-1)?.settled).not.toBe("stale");
      const left = await keptWakes(env);
      expect(left).toContainEqual(["b", "inboxChanged", "another resolver", 1]);
      expect(left.filter(([, , resolvedBy]) => resolvedBy === vaultIdentity).every(([, , , version]) => version === 1)).toBe(true);
    });

    // Another resolver's owe while the turn waits on a named session's
    // admission can't change the turn's resolver: it owes a row of its own.
    it("another resolver's owe during a named-session admission leaves the turn's own-resolver reach as it was, and makes its own row", async () => {
      const env = await wokenUnderVault(undefined, (env) => async (ctx) => {
        const get = env.stores.session.get.bind(env.stores.session);
        let owed = false;
        vi.spyOn(env.stores.session, "get").mockImplementation(async (key) => {
          const record = await get(key);
          if (key === "v" && !owed) {
            owed = true;
            await oweIntoB(env, "another resolver");
          }
          return record;
        });
        return reachVault(ctx);
      });
      expect(wokenReach).toEqual({ ok: ["vaulted"] });
      expect(await keptWakes(env)).toContainEqual(["b", "inboxChanged", "another resolver", 1]);
    });
  });
});
