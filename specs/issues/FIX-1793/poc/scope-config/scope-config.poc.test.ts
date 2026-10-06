/**
 * FIX-1793 POC · are private projects "mostly a scope configuration", and what
 * does today's engine give a workstream entry that one user writes and the org
 * reads? Experimental evidence, not a maintained test: run it with `run.sh`,
 * which copies it into packages/orchestration/test for the run.
 *
 * Everything runs on the real engine: `createFlowState` with in-memory stores,
 * the real `/api/flows` router for session creates and browser resource reads,
 * and `runAction` for admitted requests. Two verified headers stand in for a
 * real sign-in. Nothing in the scope or store layer is stubbed.
 *
 * Legs:
 *   S  scope    one project row declared twice, at org scope and at user scope, in one flow
 *   O  org      today's user scope across two orgs: the dependency on FIX-1790
 *   G  gap      the two shapes today's engine offers a workstream entry, and why neither is the rule
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { ownerSegment, type ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";

const KIND = "projects-poc";

// One row schema for both visibilities: "one project type".
const projectRow = z.object({ id: z.string(), title: z.string(), ownerUserId: z.string() });
const entryRow = z.object({ owner: z.string(), status: z.string() });
const readable = { client: { state: { read: true } } } as const;

const resources = {
  // S · the same pattern, two scopes. Only the scope differs.
  projects: defineResourceCollection({ pattern: "projects/*", scope: "org", stateSchema: projectRow, ...readable }),
  "private-projects": defineResourceCollection({ pattern: "projects/*", scope: "user", stateSchema: projectRow, ...readable }),
  // G1 · a plain org collection: every member reads AND writes every entry.
  entries: defineResourceCollection({ pattern: "entries/*", scope: "org", stateSchema: entryRow, ...readable }),
  // G2 · today's owner-private fence at org scope: the owner reads and writes, nobody else reads.
  owned: defineResourceCollection({
    pattern: "owned/[project]/[owner]/[workstream]",
    scope: "org",
    ownerPrivate: { param: "owner" },
    stateSchema: entryRow,
  }),
};

type Name = keyof typeof resources;
const col = (ctx: any, name: Name) => ctx.resources[name] as unknown as ResourceCollectionRef;
const me = (ctx: any) => ctx.session.identity.userId as string;

const keyInput = z.object({ to: z.enum(["projects", "private-projects", "entries", "owned"]), key: z.string() });

/** `owned` takes a parameter object; the rest take a string key. */
const keyFor = (ctx: any, to: Name, key: string, owner?: string) =>
  to === "owned" ? { project: "apollo", owner: ownerSegment(owner ?? me(ctx)), workstream: key } : key;

const write = handler({
  name: "write",
  inputSchema: keyInput.extend({ status: z.string(), owner: z.string().optional() }),
  outputSchema: z.null(),
  resources,
  execute: async (input, ctx: any) => {
    const ref = col(ctx, input.to);
    const key = keyFor(ctx, input.to, input.key, input.owner);
    const state =
      input.to === "projects" || input.to === "private-projects"
        ? { id: input.key, title: input.status, ownerUserId: me(ctx) }
        : { owner: input.owner ?? me(ctx), status: input.status };
    const held = await ref.getOptional(key as any);
    if (held === undefined) await ref.create(key as any, state);
    else await held.updateState(() => state);
    return null;
  },
});

const read = handler({
  name: "read",
  inputSchema: keyInput.extend({ owner: z.string().optional() }),
  outputSchema: z.object({ found: z.boolean(), state: z.unknown().optional(), listed: z.array(z.string()) }),
  resources,
  execute: async (input, ctx: any) => {
    const ref = col(ctx, input.to);
    const held = await ref.getOptional(keyFor(ctx, input.to, input.key, input.owner) as any);
    const listed = (await ref.list()).map((r: any) => String(r.path));
    return { found: held !== undefined, state: held?.state, listed };
  },
});

const flow = defineFlow({
  kind: KIND,
  resources,
  actions: {
    write: { inputSchema: write.inputSchema, block: write },
    read: { inputSchema: read.inputSchema, block: read },
  },
})({ id: KIND });

// ─── harness ──────────────────────────────────────────────────────────────

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

type Who = { user: string; org: string };
const ALICE: Who = { user: "alice", org: "acme" };
const BOB: Who = { user: "bob", org: "acme" };
const ALICE_IN_GLOBEX: Who = { user: "alice", org: "globex" };

async function boot() {
  const state = createFlowState({
    flows: { [KIND]: flow },
    resolvePrincipal: verified.resolvePrincipal,
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
  });
  const router = (await state.getRouter()) as any;
  const runtime: FlowStateRuntime = await state.getRuntime();

  const http = async (method: "GET" | "POST", path: string[], who: Who, body?: unknown) => {
    const response = await router[method](
      new Request(`http://test/api/flows/${path.join("/")}`, {
        method,
        headers: { "content-type": "application/json", "x-verified-user": who.user, "x-verified-org": who.org },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } }
    );
    const text = await response.text();
    return { status: response.status as number, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  const session = async (who: Who, sessionId: string) => {
    const res = await http("POST", [KIND, "sessions"], who, { sessionId });
    if (res.status !== 201) throw new Error(`create ${res.status}: ${JSON.stringify(res.json)}`);
    return sessionId;
  };

  const act = async (who: Who, sessionId: string, actionName: "write" | "read", input: unknown) => {
    const result = await runAction({
      orgId: who.org,
      flow,
      actionName,
      input,
      userId: who.user,
      sessionId,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    });
    if (result.error !== undefined) return { error: String((result.error as Error)?.message ?? result.error) };
    return { output: result.output as any };
  };

  /** The browser's read of one collection, by its accessor, through the public resource route. */
  const browse = async (who: Who, sessionId: string, accessor: string) =>
    http("GET", ["sessions", sessionId, "resources", accessor], who);

  return { http, session, act, browse };
}

const keysOf = (body: any): string[] => {
  const items = (body?.items ?? body?.instances ?? body?.data ?? []) as any[];
  return items.map((i) => String(i.key ?? i.path ?? i.id)).sort();
};

// ─── S · private and shared, one row, two scopes ──────────────────────────

describe("S · a project row declared at org scope and at user scope in one flow", () => {
  it("S1 the flow registers both declarations: same pattern, different scope, no collision", async () => {
    const h = await boot();
    expect(await h.session(ALICE, "s_a")).toBe("s_a");
  });

  it("S2 Alice creates a shared and a private project with one id; both land, apart", async () => {
    const h = await boot();
    await h.session(ALICE, "s_a");
    expect(await h.act(ALICE, "s_a", "write", { to: "projects", key: "apollo", status: "Shared Apollo" })).toEqual({ output: null });
    expect(await h.act(ALICE, "s_a", "write", { to: "private-projects", key: "apollo", status: "Private Apollo" })).toEqual({ output: null });
    const shared = await h.act(ALICE, "s_a", "read", { to: "projects", key: "apollo" });
    const priv = await h.act(ALICE, "s_a", "read", { to: "private-projects", key: "apollo" });
    expect(shared.output.state.title).toBe("Shared Apollo");
    expect(priv.output.state.title).toBe("Private Apollo");
  });

  it("S3 Bob lists the shared project and none of Alice's private ones; his own private id doesn't collide", async () => {
    const h = await boot();
    await h.session(ALICE, "s_a");
    await h.session(BOB, "s_b");
    await h.act(ALICE, "s_a", "write", { to: "projects", key: "apollo", status: "Shared Apollo" });
    await h.act(ALICE, "s_a", "write", { to: "private-projects", key: "hermes", status: "Alice's private" });

    const shared = await h.act(BOB, "s_b", "read", { to: "projects", key: "apollo" });
    expect(shared.output.found).toBe(true);
    const priv = await h.act(BOB, "s_b", "read", { to: "private-projects", key: "hermes" });
    expect(priv.output.found).toBe(false);
    expect(priv.output.listed).toEqual([]);

    await h.act(BOB, "s_b", "write", { to: "private-projects", key: "hermes", status: "Bob's private" });
    const alices = await h.act(ALICE, "s_a", "read", { to: "private-projects", key: "hermes" });
    expect(alices.output.state.title).toBe("Alice's private");
  });

  it("S4 the browser's resource route serves each accessor apart: Bob's read of the private one is empty", async () => {
    const h = await boot();
    await h.session(ALICE, "s_a");
    await h.session(BOB, "s_b");
    await h.act(ALICE, "s_a", "write", { to: "projects", key: "apollo", status: "Shared Apollo" });
    await h.act(ALICE, "s_a", "write", { to: "private-projects", key: "hermes", status: "Alice's private" });

    const alicePrivate = await h.browse(ALICE, "s_a", "private-projects");
    const bobPrivate = await h.browse(BOB, "s_b", "private-projects");
    const bobShared = await h.browse(BOB, "s_b", "projects");
    expect(alicePrivate.status).toBe(200);
    expect(JSON.stringify(alicePrivate.json)).toContain("Alice's private");
    expect(bobPrivate.status).toBe(200);
    expect(JSON.stringify(bobPrivate.json)).not.toContain("Alice's private");
    expect(JSON.stringify(bobShared.json)).toContain("Shared Apollo");
  });
});

// ─── O · user scope across orgs, today ────────────────────────────────────

describe("O · today's user scope is one cell across orgs (the read FIX-1790 closes)", () => {
  it("O1 Alice in Globex reads the private project she made in Acme", async () => {
    const h = await boot();
    await h.session(ALICE, "s_a");
    await h.session(ALICE_IN_GLOBEX, "s_g");
    await h.act(ALICE, "s_a", "write", { to: "private-projects", key: "hermes", status: "Made in Acme" });
    const fromGlobex = await h.act(ALICE_IN_GLOBEX, "s_g", "read", { to: "private-projects", key: "hermes" });
    // Today's truth, pinned. When FIX-1790 lands this reads `false`, and this leg goes red on purpose.
    expect(fromGlobex.output.found).toBe(true);
  });
});

// ─── G · a workstream entry on today's engine ─────────────────────────────

describe("G · neither shape today's engine offers is 'the owner writes, the org reads'", () => {
  it("G1 a plain org collection: Bob reads Alice's entry, and overwrites it", async () => {
    const h = await boot();
    await h.session(ALICE, "s_a");
    await h.session(BOB, "s_b");
    await h.act(ALICE, "s_a", "write", { to: "entries", key: "apollo.checkout", status: "on track", owner: "alice" });
    const read = await h.act(BOB, "s_b", "read", { to: "entries", key: "apollo.checkout" });
    expect(read.output.state.status).toBe("on track");
    const overwrite = await h.act(BOB, "s_b", "write", { to: "entries", key: "apollo.checkout", status: "cancelled", owner: "alice" });
    expect(overwrite).toEqual({ output: null });
    const after = await h.act(ALICE, "s_a", "read", { to: "entries", key: "apollo.checkout" });
    expect(after.output.state.status).toBe("cancelled"); // too weak: nothing stopped a non-owner write
  });

  it("G2 an owner-private org collection: Bob can't overwrite Alice's entry, and can't read it either", async () => {
    const h = await boot();
    await h.session(ALICE, "s_a");
    await h.session(BOB, "s_b");
    await h.act(ALICE, "s_a", "write", { to: "owned", key: "checkout", status: "on track" });
    const own = await h.act(ALICE, "s_a", "read", { to: "owned", key: "checkout" });
    expect(own.output.found).toBe(true);

    const bobRead = await h.act(BOB, "s_b", "read", { to: "owned", key: "checkout", owner: "alice" });
    expect(bobRead.output.found).toBe(false); // too strong: the org can't see the entry
    expect(bobRead.output.listed).toEqual([]);

    const bobWrite = await h.act(BOB, "s_b", "write", { to: "owned", key: "checkout", status: "cancelled", owner: "alice" });
    expect(bobWrite.error ?? "").toMatch(/owner-private|belongs to/i);
  });

  it("G3 an owner-private collection has no browser read, so the app can't list entries either", async () => {
    const h = await boot();
    await h.session(ALICE, "s_a");
    await h.act(ALICE, "s_a", "write", { to: "owned", key: "checkout", status: "on track" });
    const res = await h.browse(ALICE, "s_a", "owned");
    expect(res.status).not.toBe(200);
  });
});
