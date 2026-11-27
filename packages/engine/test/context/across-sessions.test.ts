/**
 * A block reading one collection across every session its owner has:
 * `ctx.resources.acrossSessions().<name>.list()`, on the real path
 * (`runAction` → `createExecutionContext` → the block).
 *
 * Why these matter: a screen of every task in a user's sessions reads them in
 * one call, and must never show a row of a session the caller couldn't name
 * with `ctx.resources.at`: another user's, another org's or tenant's, one an
 * own-resolver flow refuses. A refused session is left out exactly as one that
 * holds nothing, and nothing the read hands back (a row, a cursor) names it.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowRegistry, defaultBodyUserIdPrincipalResolver, runAction } from "../../src";
import { createInboundTransportHost, createInMemoryBus, createInMemoryStores, type PrincipalResolver } from "../../src/host";
import { dispatchInternalAs } from "../../src/durability/dispatch-internal";
import type { StoreRegistry } from "../../src/stores/types";

const ORG = "acme";

const notes = defineResourceCollection({
  pattern: "notes/*",
  scope: "session",
  stateSchema: z.object({ text: z.string(), status: z.string().default("open") }),
  indexes: { byStatus: (_key, state) => state.status }
});

type Op = (ctx: any) => Promise<unknown>;
let op: Op = async () => null;
let lastOut: unknown;

const seed = handler({
  name: "seed",
  inputSchema: z.object({ rows: z.array(z.object({ key: z.string(), text: z.string(), status: z.string().optional() })) }),
  outputSchema: z.object({}),
  execute: async ({ rows }, ctx) => {
    for (const row of rows) await (ctx.resources as any).notes.create(row.key, { text: row.text, ...(row.status ? { status: row.status } : {}) });
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

const vaultResolver: PrincipalResolver = async () => ({ userId: "alice", orgId: ORG });
const vault = defineFlow({ kind: "vault", actions: { seed }, resources: { notes }, authentication: { resolvePrincipal: vaultResolver } })();
const alpha = defineFlow({ kind: "alpha", actions: { seed, reach }, internal: { actions: { reach: { block: reach } } }, resources: { notes } })();
const beta = defineFlow({ kind: "beta", actions: { seed, reach }, resources: { notes } })();

async function boot() {
  const registry = createFlowRegistry();
  registry.register(alpha);
  registry.register(beta);
  registry.register(vault);
  const stores: StoreRegistry = { ...createInMemoryStores(), bus: createInMemoryBus() };
  const runtimeConfig = { requestHost: { flows: registry }, hostResolver: defaultBodyUserIdPrincipalResolver };
  const as = (userId: string, orgId = ORG) => ({ userId, orgId, principalKind: "person" as const, source: "http" });
  const seedIn = async (
    flow: typeof alpha,
    sessionId: string,
    rows: Array<{ key: string; text: string; status?: string }>,
    who: Record<string, unknown> = as("alice")
  ) => {
    const result = await runAction({ flow, actionName: "seed", input: { rows }, sessionId, stores, runtimeConfig, ...(who as ReturnType<typeof as>) });
    expect(result.error).toBeUndefined();
  };
  /** Run `fn` as a block in alice's session `a` and return what it got back. */
  const reachFrom = async (fn: Op, who: Record<string, unknown> = as("alice"), sessionId = "a") => {
    op = fn;
    const result = await runAction({ flow: alpha, actionName: "reach", input: {}, sessionId, stores, runtimeConfig, ...(who as ReturnType<typeof as>) });
    expect(result.error).toBeUndefined();
    return (result.output as { out: unknown }).out;
  };
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
  /** Plant a session as a store holds it, for the cases no door makes: another tenant's, one with no org. */
  const plant = async (key: string, fields: { tenantId?: string; orgId?: string | null; parentSessionId?: string }) => {
    const now = Date.now();
    await stores.session.set(
      key,
      {
        id: key,
        state: {},
        version: 0,
        createdAt: now,
        updatedAt: now,
        flowKind: "beta",
        flowId: "beta",
        userId: "alice",
        journal: [],
        principalKind: "person",
        ...(fields.orgId === null ? {} : { orgId: fields.orgId ?? ORG }),
        ...(fields.tenantId !== undefined ? { tenantId: fields.tenantId } : {}),
        ...(fields.parentSessionId !== undefined ? { parentSessionId: fields.parentSessionId } : {})
      } as never,
      "absent"
    );
    await stores.resourceState.set("session", key, "notes/planted", { text: `planted ${key}`, status: "open" } as never, "any");
  };
  return { stores, seedIn, reachFrom, reachFromDelivery, plant, as };
}

/** Every page of `notes` across sessions, as `session key text` lines, and the pages' sizes. */
const listAll: Op = async (ctx) => {
  const lines: string[] = [];
  const sizes: number[] = [];
  let after: string | undefined;
  for (let pages = 0; pages < 20; pages += 1) {
    const page = await ctx.resources.acrossSessions().notes.list(after === undefined ? {} : { after });
    sizes.push(page.rows.length);
    for (const row of page.rows) lines.push(`${row.session} ${row.key} ${row.value.text}`);
    if (page.next === undefined) return { lines, sizes };
    after = page.next;
  }
  throw new Error("the listing never ended");
};

describe("ctx.resources.acrossSessions()", () => {
  it("lists one collection's rows from every session its owner has, each with its session", async () => {
    const env = await boot();
    await env.seedIn(alpha, "a", [{ key: "1", text: "mine" }]);
    await env.seedIn(beta, "b", [{ key: "1", text: "theirs" }, { key: "2", text: "theirs too" }]);
    await env.plant("b-child", { parentSessionId: "b" });
    const out = (await env.reachFrom(listAll)) as { ok: { lines: string[] } };
    expect(out.ok.lines).toEqual([
      "a notes/1 mine",
      "b notes/1 theirs",
      "b notes/2 theirs too",
      "b-child notes/planted planted b-child"
    ]);
  });

  it("refuses exactly the sessions ctx.resources.at refuses: each is left out as though it held nothing", async () => {
    const env = await boot();
    await env.seedIn(alpha, "a", [{ key: "1", text: "mine" }]);
    await env.seedIn(beta, "b", [{ key: "1", text: "theirs" }]);
    await env.seedIn(beta, "bob-s", [{ key: "1", text: "bob's" }], env.as("bob"));
    await env.seedIn(beta, "other-org", [{ key: "1", text: "elsewhere" }], env.as("alice", "globex"));
    await env.seedIn(vault, "vault-s", [{ key: "1", text: "vaulted" }]);
    await env.plant("no-org", { orgId: null });
    await env.plant("t2:other-tenant", { tenantId: "t2" });
    const listed = ((await env.reachFrom(listAll)) as { ok: { lines: string[] } }).ok.lines;
    const sessionsListed = new Set(listed.map((line) => line.split(" ")[0]));
    for (const target of ["a", "b", "bob-s", "other-org", "vault-s", "no-org", "other-tenant"]) {
      const reached = await env.reachFrom(async (ctx) => (await ctx.resources.at({ session: target }).notes.list()).length);
      const atReaches = (reached as { ok?: number }).ok !== undefined;
      expect(sessionsListed.has(target), `${target}: at() ${atReaches ? "reaches" : "refuses"} it`).toBe(atReaches);
    }
    expect([...sessionsListed].sort()).toEqual(["a", "b"]);
  });

  it("lists only a machine's own session: a machine owns nothing else", async () => {
    const env = await boot();
    await env.seedIn(beta, "b", [{ key: "1", text: "theirs" }]);
    const machine = { userId: "alice", orgId: ORG, principalKind: "machine", source: "internal" };
    const out = await env.reachFrom(async (ctx) => {
      await ctx.resources.notes.create("1", { text: "the machine's" });
      return listAll(ctx);
    }, machine, "machine-own");
    expect((out as { ok: { lines: string[] } }).ok.lines).toEqual(["machine-own notes/1 the machine's"]);
  });

  it("refuses a turn a webhook delivery started, as ctx.resources.at does, naming the rule", async () => {
    const env = await boot();
    await env.seedIn(alpha, "a", [{ key: "1", text: "mine" }]);
    const across = await env.reachFromDelivery(async (ctx) => ctx.resources.acrossSessions().notes.list());
    const named = await env.reachFromDelivery(async (ctx) => ctx.resources.at({ session: "b" }).notes.list());
    expect(across).toEqual(named);
    expect(across).toMatchObject({ name: "UntrustedReachError" });
  });

  it("pages by the last row read: a page of dropped rows is empty with `next` set, and the cursor names none of them", async () => {
    const env = await boot();
    // Sixty rows of a session the read refuses (its flow resolves its own callers) sort first.
    await env.seedIn(vault, "a-vault", Array.from({ length: 60 }, (_, i) => ({ key: `secret-${String(i).padStart(2, "0")}`, text: "vaulted" })));
    await env.seedIn(beta, "b", [{ key: "1", text: "theirs" }]);
    const pages: Array<{ rows: number; next?: string }> = [];
    const out = await env.reachFrom(async (ctx) => {
      let after: string | undefined;
      const lines: string[] = [];
      for (let i = 0; i < 10; i += 1) {
        const page = await ctx.resources.acrossSessions().notes.list(after === undefined ? {} : { after });
        pages.push({ rows: page.rows.length, ...(page.next !== undefined ? { next: page.next } : {}) });
        lines.push(...page.rows.map((row: { session: string; key: string }) => `${row.session} ${row.key}`));
        if (page.next === undefined) break;
        after = page.next;
      }
      return lines;
    });
    expect(out).toEqual({ ok: ["b notes/1"] });
    expect(pages[0]).toMatchObject({ rows: 0 });
    expect(pages[0]!.next).toBeTypeOf("string");
    expect(pages.at(-1)!.next).toBeUndefined();
    for (const page of pages) {
      if (page.next === undefined) continue;
      expect(page.next).not.toMatch(/vault|secret|notes/);
      expect(Buffer.from(page.next, "base64url").toString("latin1")).not.toMatch(/vault|secret|notes/);
    }
  });

  it("refuses a cursor it didn't hand back, or one handed back for another filter", async () => {
    const env = await boot();
    await env.seedIn(alpha, "a", Array.from({ length: 55 }, (_, i) => ({ key: `n${String(i).padStart(2, "0")}`, text: "x" })));
    const out = await env.reachFrom(async (ctx) => {
      const first = await ctx.resources.acrossSessions().notes.list();
      const reused = await ctx.resources.acrossSessions().notes.list({ after: first.next, where: { index: "byStatus", value: "open" } }).catch((e: Error) => e.name);
      const forged = await ctx.resources.acrossSessions().notes.list({ after: "not-a-cursor" }).catch((e: Error) => e.name);
      const second = await ctx.resources.acrossSessions().notes.list({ after: first.next });
      return { reused, forged, second: second.rows.length };
    });
    expect(out).toEqual({ ok: { reused: "AcrossSessionsCursorError", forged: "AcrossSessionsCursorError", second: 5 } });
  });

  it("filters by a row's key, one row a session, and by a declared index, re-checked against each row", async () => {
    const env = await boot();
    await env.seedIn(alpha, "a", [{ key: "t1", text: "a1", status: "done" }, { key: "t10", text: "a10" }]);
    await env.seedIn(beta, "b", [{ key: "t1", text: "b1" }, { key: "t2", text: "b2", status: "done" }]);
    const out = await env.reachFrom(async (ctx) => {
      const across = ctx.resources.acrossSessions().notes;
      const byKey = await across.list({ where: { key: "notes/t1" } });
      const done = await across.list({ where: { index: "byStatus", value: "done" } });
      return {
        byKey: byKey.rows.map((r: { session: string; value: { text: string } }) => `${r.session} ${r.value.text}`),
        done: done.rows.map((r: { session: string; value: { text: string } }) => `${r.session} ${r.value.text}`)
      };
    });
    expect(out).toEqual({ ok: { byKey: ["a a1", "b b1"], done: ["a a1", "b b2"] } });
  });

  it("refuses a filter on a field with no declared index, naming it, rather than filtering after the read", async () => {
    const env = await boot();
    await env.seedIn(alpha, "a", [{ key: "1", text: "mine" }]);
    const out = await env.reachFrom(async (ctx) => ctx.resources.acrossSessions().notes.list({ where: { index: "text", value: "mine" } }));
    expect(out).toMatchObject({ error: expect.stringContaining('declares no index "text"') });
  });
});
