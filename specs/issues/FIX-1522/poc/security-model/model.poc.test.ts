/**
 * FIX-1522 POC · the multitenancy model, as the engine enforces it today.
 * Experimental evidence, not a maintained test — run it with `run.sh`.
 *
 * Every answer comes from the REAL `/api/flows` router under a verified
 * principal (two headers standing in for a real verifier). Legs:
 *
 *   M  membership   how users, orgs and sessions relate
 *   S  scopes       which storage cells are shared with whom
 *   F  flows        who can see and run a registered flow instance
 *   T  tenant       what the tenant header does and does not separate
 *
 * Names ending in `CROSS-ORG` pin a path from one org into another that works
 * today. They assert what IS true, so a fix shows up here as a red test.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResource, defineResourceCollection, handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { hireWorkforce } from "../src/hire";
import { workerConfigSchema } from "../src/worker-config";

// ─── the app: one app flow and one seat kind, sharing the same doors ──────

const note = z.object({ text: z.string(), by: z.string(), org: z.string() });
const readable = { client: { state: { read: true } } } as const;

/** One cell per scope, so each leg can ask "whose cell did that land in". */
const resources = {
  orgNotes: defineResourceCollection({ pattern: "notes/*", scope: "org", stateSchema: note, ...readable }),
  userNotes: defineResourceCollection({ pattern: "mine/*", scope: "user", stateSchema: note, ...readable }),
  /** What a seat's run reveals about the seat it ran as. */
  seen: defineResourceCollection({
    pattern: "seen/*",
    scope: "org",
    stateSchema: z.object({ instance: z.string(), instructions: z.string().nullable() }),
    ...readable,
  }),
  profile: defineResource({ ref: "profile", scope: "user", stateSchema: z.object({ name: z.string().default("") }) }),
};

const write = handler({
  name: "write",
  inputSchema: z.object({ where: z.enum(["org", "user"]), text: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  resources,
  execute: async (input, ctx) => {
    const { userId = "", orgId = "" } = ctx.session.identity;
    const ref = ctx.resources[input.where === "org" ? "orgNotes" : "userNotes"] as unknown as ResourceCollectionRef;
    await ref.create(input.text, { text: input.text, by: userId, org: orgId });
    return { ok: true };
  },
});

/** Runs as whatever instance it was addressed through, and records that instance's config. */
const whoami = handler({
  name: "whoami",
  inputSchema: z.object({ tag: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  resources,
  execute: async (input, ctx) => {
    const seen = ctx.resources.seen as unknown as ResourceCollectionRef;
    const config = ctx.flow.config as { instructions?: string } | undefined;
    // The running instance's id is present at runtime but not on the public
    // FlowContextView type, hence the narrow cast.
    const instance = (ctx.flow as unknown as { id: string }).id;
    await seen.create(input.tag, { instance, instructions: config?.instructions ?? null });
    return { ok: true };
  },
});

const actions = {
  write: { inputSchema: write.inputSchema, block: write },
  whoami: { inputSchema: whoami.inputSchema, block: whoami },
};

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

const APP = "app";
const appFlow = (auth: boolean) => defineFlow({ kind: APP, resources, actions, ...(auth ? { authentication: verified } : {}) });

/** The seat kind — what an org's hire turns into. Its instructions are the org's own. */
const seatKind = defineFlow({
  kind: "seat",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  resources,
  actions,
  authentication: verified,
});

// ─── harness ───────────────────────────────────────────────────────────────

type Who = { user: string; org: string; tenant?: string };
type Answer = { status: number; json: any };

async function boot(auth = true) {
  const state = createFlowState({
    flows: { [APP]: appFlow(auth)() },
    // Host-level too, so the cross-flow listings (M4) are scoped to a caller
    // rather than withheld — the documented setup for an app that verifies.
    ...(auth ? { resolvePrincipal: verified.resolvePrincipal } : {}),
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
  });
  const router = (await state.getRouter()) as any;
  const runtime = await state.getRuntime();

  const call = async (method: "GET" | "POST", path: string[], who: Who, body?: unknown): Promise<Answer> => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (auth) Object.assign(headers, { "x-verified-user": who.user, "x-verified-org": who.org });
    if (who.tenant) headers["x-tenant-id"] = who.tenant;
    const response = await router[method](
      new Request(`http://test/api/flows/${path.join("/")}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } }
    );
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  const open = async (who: Who, flowId = APP): Promise<string> => {
    const { status, json } = await call("POST", [flowId, "sessions"], who, { userId: who.user, orgId: who.org });
    if (status >= 400) throw new Error(`createSession ${status}: ${JSON.stringify(json)}`);
    return json.session?.id ?? json.id;
  };

  /** Run one action; the outcome is the final status, or `vanished` / the HTTP refusal. */
  const act = async (who: Who, sessionId: string, action: string, input: unknown, flowId = APP) => {
    const posted = await call("POST", [flowId, sessionId, "actions", action], who, { userId: who.user, input });
    if (posted.status >= 400) return { http: posted.status, error: posted.json?.error as string | undefined };
    const requestId = posted.json.request?.id;
    for (let i = 0; i < 100; i++) {
      const seen = (await call("GET", [flowId, "requests", requestId, "status"], who)).json?.status;
      if (seen && !["pending", "in_progress", "running", "queued"].includes(seen)) return { http: posted.status, outcome: seen };
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return { http: posted.status, outcome: "vanished" };
  };

  const must = async (...args: Parameters<typeof act>) => {
    const result = await act(...args);
    if (result.outcome !== "completed") throw new Error(`${args[2]}: ${JSON.stringify(result)}`);
  };

  const read = (who: Who, sessionId: string, ref: string) => call("GET", ["sessions", sessionId, "resources", ref], who);
  const texts = (answer: Answer) => (answer.json?.items ?? []).map((i: any) => i.clientData?.text).sort();

  /** Register a seat the way a hire does: an instance of the seat kind with its org's instructions. */
  const hireSeat = (address: string, instructions: string) =>
    state.register(hireWorkforce([{ id: address, declared: { flow: "seat" }, body: instructions }], { kinds: { seat: seatKind } })[0]!);

  return { state, runtime, call, open, act, must, read, texts, hireSeat };
}

const ALICE: Who = { user: "alice", org: "acme" };
const BOB: Who = { user: "bob", org: "acme" };
const ALICE_GLOBEX: Who = { user: "alice", org: "globex" };
const MALLORY: Who = { user: "mallory", org: "globex" };

// ─── M · membership: how users, orgs and sessions relate ─────────────────

describe("M · membership", () => {
  it("M1 many users per org: every member reads the org's cell", async () => {
    const h = await boot();
    await h.must(ALICE, await h.open(ALICE), "write", { where: "org", text: "acme-plan" });
    expect(h.texts(await h.read(BOB, await h.open(BOB), "orgNotes"))).toEqual(["acme-plan"]);
  });

  it("M2 many orgs per user: the verifier names the org per request, and nothing checks membership", async () => {
    // No membership table exists to consult. Whatever org the verified
    // principal names is the org — so one person holds a session in each.
    const h = await boot();
    const inAcme = await h.open(ALICE);
    const inGlobex = await h.open(ALICE_GLOBEX);
    await h.must(ALICE, inAcme, "write", { where: "org", text: "acme-plan" });
    await h.must(ALICE_GLOBEX, inGlobex, "write", { where: "org", text: "globex-plan" });
    expect(h.texts(await h.read(ALICE, inAcme, "orgNotes"))).toEqual(["acme-plan"]);
    expect(h.texts(await h.read(ALICE_GLOBEX, inGlobex, "orgNotes"))).toEqual(["globex-plan"]);
  });

  it("M3 a session belongs to one user and one org for life", async () => {
    const h = await boot();
    const inAcme = await h.open(ALICE);
    // Same person, now signed into globex, reusing her acme session.
    const read = await h.read(ALICE_GLOBEX, inAcme, "orgNotes");
    expect(read).toEqual({ status: 403, json: { error: "Caller's organization does not own the requested resource" } });
    // Acting in it is acked and then refused at admission — nothing written.
    expect(await h.act(ALICE_GLOBEX, inAcme, "write", { where: "org", text: "x" })).toEqual({ http: 202, outcome: "vanished" });
    expect(Object.keys(await h.runtime.stores.resourceState.getByPrefix("org", "globex", "notes/"))).toEqual([]);
    // Another user of the same org cannot read it either.
    expect((await h.read(BOB, inAcme, "orgNotes")).status).toBe(403);
  });

  it("M4 session listings are scoped to the caller's user AND the org they are acting for", async () => {
    const h = await boot();
    const inAcme = await h.open(ALICE);
    const inGlobex = await h.open(ALICE_GLOBEX);
    await h.open(BOB);
    const ids = async (who: Who) => ((await h.call("GET", ["sessions"], who)).json.sessions ?? []).map((s: any) => s.id);
    expect(await ids(ALICE_GLOBEX)).toEqual([inGlobex]);
    expect(await ids(ALICE)).toEqual([inAcme]);
  });
});

// ─── S · scopes: which cells are shared with whom ─────────────────────────

describe("S · scopes", () => {
  it("S1 org scope: one cell per org, shared by every member and every flow", async () => {
    const h = await boot();
    await h.must(ALICE, await h.open(ALICE), "write", { where: "org", text: "acme-plan" });
    expect(h.texts(await h.read(MALLORY, await h.open(MALLORY), "orgNotes"))).toEqual([]);
    expect(Object.keys(await h.runtime.stores.resourceState.getByPrefix("org", "acme", "notes/"))).toEqual(["notes/acme-plan"]);
  });

  it("S2 user scope: one cell per person, shared across every org they are in", async () => {
    const h = await boot();
    await h.must(ALICE, await h.open(ALICE), "write", { where: "user", text: "acme-private" });
    expect(h.texts(await h.read(ALICE_GLOBEX, await h.open(ALICE_GLOBEX), "userNotes"))).toEqual(["acme-private"]);
    expect(h.texts(await h.read(BOB, await h.open(BOB), "userNotes"))).toEqual([]);
  });
});

// ─── F · flows: who can see and run a registered instance ─────────────────

describe("F · flows", () => {
  it("F1 there is one registry per process: every org is served the same flows", async () => {
    const h = await boot();
    h.hireSeat("acme.eng.lead", "ACME-CONFIDENTIAL: you work on acme's roadmap");
    h.hireSeat("globex.ops.pager", "GLOBEX-CONFIDENTIAL: you page globex on-call");
    const forAcme = (await h.call("GET", [], ALICE)).json.flows.map((f: any) => f.id).sort();
    const forGlobex = (await h.call("GET", [], MALLORY)).json.flows.map((f: any) => f.id).sort();
    expect(forAcme).toEqual(["acme.eng.lead", "app", "globex.ops.pager"]);
    expect(forGlobex).toEqual(forAcme);
  });

  it("F2 CROSS-ORG another org's user can open a session on acme's seat and run it", async () => {
    const h = await boot();
    h.hireSeat("acme.eng.lead", "ACME-CONFIDENTIAL: you work on acme's roadmap");
    const onAcmeSeat = await h.open(MALLORY, "acme.eng.lead");
    const ran = await h.act(MALLORY, onAcmeSeat, "whoami", { tag: "probe" }, "acme.eng.lead");
    expect(ran).toEqual({ http: 202, outcome: "completed" });

    // The run carried acme's instructions — the seat's system prompt — and
    // wrote them where mallory can read them: her own org's cell.
    const seen = await h.read(MALLORY, onAcmeSeat, "seen");
    expect(seen.json.items.map((i: any) => i.clientData)).toEqual([
      { instance: "acme.eng.lead", instructions: "ACME-CONFIDENTIAL: you work on acme's roadmap" },
    ]);
    expect(Object.keys(await h.runtime.stores.resourceState.getByPrefix("org", "globex", "seen/"))).toEqual(["seen/probe"]);
    expect(Object.keys(await h.runtime.stores.resourceState.getByPrefix("org", "acme", "seen/"))).toEqual([]);
  });

  it("F3 the seat's data stays put: running acme's seat reads the CALLER's org, not acme's", async () => {
    const h = await boot();
    h.hireSeat("acme.eng.lead", "ACME-CONFIDENTIAL");
    await h.must(ALICE, await h.open(ALICE), "write", { where: "org", text: "acme-plan" });
    const onAcmeSeat = await h.open(MALLORY, "acme.eng.lead");
    expect(h.texts(await h.read(MALLORY, onAcmeSeat, "orgNotes"))).toEqual([]);
  });
});

// ─── T · the tenant header ────────────────────────────────────────────────

describe("T · tenant", () => {
  it("T1 the tenant comes from a request header the caller sets, and partitions sessions only", async () => {
    const h = await boot();
    const t1 = { ...ALICE, tenant: "t1" };
    const t2 = { ...ALICE, tenant: "t2" };
    const inT1 = await h.open(t1);
    await h.must(t1, inT1, "write", { where: "org", text: "t1-org" });
    await h.must(t1, inT1, "write", { where: "user", text: "t1-user" });

    // Same session id under another tenant: not found.
    expect((await h.read(t2, inT1, "orgNotes")).status).toBe(404);
    // A fresh session under t2 reads the SAME org and user cells.
    const inT2 = await h.open(t2);
    expect(h.texts(await h.read(t2, inT2, "orgNotes"))).toEqual(["t1-org"]);
    expect(h.texts(await h.read(t2, inT2, "userNotes"))).toEqual(["t1-user"]);
  });
});

// ─── U · an app with no verifier ──────────────────────────────────────────

describe("U · unverified", () => {
  it("U1 every caller shares one org, and names their own user", async () => {
    const h = await boot(false);
    const a = await h.open({ user: "alice", org: "ignored" });
    await h.must({ user: "alice", org: "ignored" }, a, "write", { where: "org", text: "alice-plan" });
    // Anyone may claim to be anyone; and every claim lands in one org.
    const stranger = await h.open({ user: "stranger", org: "ignored" });
    expect(h.texts(await h.read({ user: "stranger", org: "ignored" }, stranger, "orgNotes"))).toEqual(["alice-plan"]);
  });
});
