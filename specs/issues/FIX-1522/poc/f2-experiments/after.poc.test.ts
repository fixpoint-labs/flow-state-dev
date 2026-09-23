/**
 * FIX-1522 POC · the F2 experiments, AFTER the fix (run on the FIX-1529 branch).
 *
 * Same harness as the before suite, but a hire goes the way a hire writer
 * does: pinned. Legs named `CLOSED` expect the fence to refuse. Legs named
 * `PROBE` look for a way around it the ship's own suite doesn't try; they log
 * what they find rather than assert a verdict. Run with `run-after.sh`.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, dispatcher, handler } from "@flow-state-dev/core";
import type { InstanceOwnerPin, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { hireWorkforce } from "../src/hire";
import {
  defineHiredRosterCollection,
  defineHiredRosterPrivateCollection,
  reloadHiredSeats,
} from "../src/roster";
import { workerConfigSchema } from "../src/worker-config";

const readable = { client: { state: { read: true } } } as const;
const resources = {
  seen: defineResourceCollection({
    pattern: "seen/*",
    scope: "org",
    stateSchema: z.object({ instance: z.string(), as: z.string(), instructions: z.string().nullable() }),
    ...readable,
  }),
  roster: defineHiredRosterCollection(),
};
const tagInput = z.object({ tag: z.string() });

const whoami = handler({
  name: "whoami",
  inputSchema: tagInput,
  outputSchema: z.object({ ok: z.boolean() }),
  resources,
  execute: async (input, ctx) => {
    const seen = ctx.resources.seen as unknown as ResourceCollectionRef;
    const config = ctx.flow.config as { instructions?: string } | undefined;
    const instance = (ctx.flow as unknown as { id: string }).id;
    const { userId = "", orgId = "" } = ctx.session.identity;
    await seen.create(input.tag, { instance, as: `${userId}@${orgId}`, instructions: config?.instructions ?? null });
    return { ok: true };
  },
});

const handToAcmeSeat = dispatcher({
  name: "hand-to-acme-seat",
  type: "internal",
  flowKind: "acme.eng.lead",
  action: "whoami",
  inputSchema: tagInput,
  session: { key: (input) => input.tag },
});

/** PROBE: any flow may declare the private writer. Can it list other users' rows? */
const privateRoster = defineHiredRosterPrivateCollection();
const peekPrivate = handler({
  name: "peek-private",
  inputSchema: tagInput,
  outputSchema: z.object({ ok: z.boolean() }),
  resources: { ...resources, privateRoster },
  execute: async (input, ctx) => {
    const rows = await (ctx.resources.privateRoster as unknown as ResourceCollectionRef).list();
    const seen = ctx.resources.seen as unknown as ResourceCollectionRef;
    const { userId = "", orgId = "" } = ctx.session.identity;
    const instructions = (rows as any[]).map((r) => (r.state ?? r.data ?? r)?.instructions).join("|");
    await seen.create(input.tag, { instance: "peek", as: `${userId}@${orgId}`, instructions });
    return { ok: true };
  },
});

/** PROBE-B2: read one other user's row by its exact key. */
const peekAlice = handler({
  name: "peek-alice",
  inputSchema: tagInput,
  outputSchema: z.object({ ok: z.boolean() }),
  resources: { ...resources, privateRoster },
  execute: async (input, ctx) => {
    const ref = ctx.resources.privateRoster as unknown as ResourceCollectionRef;
    let got: string;
    try {
      const row = await ref.getOptional({ owner: "~alice", seat: "research" });
      got = row === undefined ? "undefined" : JSON.stringify((row as any).state ?? row);
    } catch (e) {
      got = `threw: ${(e as Error).message}`;
    }
    const seen = ctx.resources.seen as unknown as ResourceCollectionRef;
    const { userId = "", orgId = "" } = ctx.session.identity;
    await seen.create(input.tag, { instance: "peek-alice", as: `${userId}@${orgId}`, instructions: got });
    return { ok: true };
  },
});

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

const APP = "app";
const appFlow = defineFlow({
  kind: APP,
  resources: { ...resources, privateRoster },
  actions: {
    whoami: { inputSchema: tagInput, block: whoami },
    hand: { inputSchema: tagInput, block: handToAcmeSeat },
    peek: { inputSchema: tagInput, block: peekPrivate },
    peekAlice: { inputSchema: tagInput, block: peekAlice },
  },
  authentication: verified,
});

const seatKind = defineFlow({
  kind: "seat",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  resources,
  actions: { whoami: { inputSchema: tagInput, block: whoami } },
  internal: { actions: { whoami: { block: whoami } } },
  authentication: verified,
});
const kinds = { seat: seatKind };

type Who = { user: string; org: string };
type Stores = ReturnType<typeof inMemoryStores>;

async function boot(stores: Stores = inMemoryStores(), extra: Record<string, unknown> = {}) {
  const state = createFlowState({
    ...extra,
    flows: { [APP]: appFlow() },
    resolvePrincipal: verified.resolvePrincipal,
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({}),
  });
  const router = (await state.getRouter()) as any;
  const runtime = await state.getRuntime();
  const call = async (method: "GET" | "POST", path: string[], who: Who | null, body?: unknown) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (who) Object.assign(headers, { "x-verified-user": who.user, "x-verified-org": who.org });
    const response = await router[method](
      new Request(`http://test/api/flows/${path.join("/")}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } }
    );
    const text = await response.text();
    return { status: response.status as number, json: text.length > 0 ? JSON.parse(text) : undefined };
  };
  const open = async (who: Who, flowId = APP) => {
    const { status, json } = await call("POST", [flowId, "sessions"], who, { userId: who.user });
    return status >= 400 ? { status, error: json?.error } : { status, id: (json.session?.id ?? json.id) as string };
  };
  const act = async (who: Who, sessionId: string | undefined, action: string, input: unknown, flowId = APP) => {
    const path = sessionId === undefined ? [flowId, "actions", action] : [flowId, sessionId, "actions", action];
    const posted = await call("POST", path, who, { userId: who.user, input });
    if (posted.status >= 400) return { http: posted.status, error: posted.json?.error as string | undefined };
    const requestId = posted.json.request?.id;
    for (let i = 0; i < 100; i++) {
      const seen = (await call("GET", [flowId, "requests", requestId, "status"], who)).json?.status;
      if (seen && !["pending", "in_progress", "running", "queued"].includes(seen)) return { http: posted.status, outcome: seen };
      await new Promise((r) => setTimeout(r, 5));
    }
    return { http: posted.status, outcome: "vanished" };
  };
  const seenIn = async (org: string) =>
    Object.values(await runtime.stores.resourceState.getByPrefix("org", org, "seen/")).map((row: any) => row.state);
  const settle = async (ms = 300) => new Promise((r) => setTimeout(r, ms));
  const hire = (address: string, instructions: string, pin?: InstanceOwnerPin) =>
    state.register(hireWorkforce([{ id: address, declared: { flow: "seat" }, body: instructions }], { kinds })[0]!, pin ? { pin } : undefined);
  return { state, runtime, call, open, act, seenIn, settle, hire };
}

const storeRow = async (stores: Stores, org: string, key: string, row: Record<string, unknown>) =>
  (await stores.resolve(["primary"])).resourceState!.set("org", org, `workforce/roster/${key}`, row as any, "any");

const ALICE: Who = { user: "alice", org: "acme" };
const BOB: Who = { user: "bob", org: "acme" };
const MALLORY: Who = { user: "mallory", org: "globex" };
const ACME_PROMPT = "ACME-CONFIDENTIAL";
const ACME = { orgId: "acme" };

describe("after · the fence", () => {
  it("E3 CLOSED a session opened BEFORE the pin existed is refused on resume after the reload pins the seat", async () => {
    const stores = inMemoryStores();
    await storeRow(stores, "acme", "eng.lead", { seatId: "eng.lead", flow: "seat", settings: {}, instructions: ACME_PROMPT });
    // Process 1 = pre-fix: the seat registered with no pin, as main did.
    const first = await boot(stores);
    first.hire("acme.eng.lead", ACME_PROMPT);
    const opened = await first.open(MALLORY, "acme.eng.lead");
    expect(opened.status).toBe(201);
    // Process 2 = the fix: the shipped reload pins the legacy row to its cell.
    const second = await boot(stores);
    const reloaded = await reloadHiredSeats({ stores: second.runtime.stores, orgIds: ["acme"], kinds });
    reloaded.seats.forEach((seat) => second.state.register(seat));
    expect(second.runtime.registry.pinOf("acme.eng.lead")).toEqual({ orgId: "acme" });
    const resumed = await second.act(MALLORY, (opened as any).id, "whoami", { tag: "resume" }, "acme.eng.lead");
    expect(resumed.outcome ?? resumed.http).not.toBe("completed");
    expect(await second.seenIn("globex")).toEqual([]);
  });

  it("E7 CLOSED mallory's internal dispatch to a pinned acme seat never runs it", async () => {
    const h = await boot();
    h.hire("acme.eng.lead", ACME_PROMPT, ACME);
    const s = await h.open(MALLORY);
    await h.act(MALLORY, (s as any).id, "hand", { tag: "handed" });
    await h.settle();
    expect(await h.seenIn("globex")).toEqual([]);
    // Control: alice's dispatch of the same action runs.
    const a = await h.open(ALICE);
    await h.act(ALICE, (a as any).id, "hand", { tag: "handed" });
    await h.settle();
    expect((await h.seenIn("acme")).map((r: any) => r.as)).toEqual(["alice@acme"]);
  });

  it("E1/E2 CLOSED foreign org and roster peer get 404 before any ack, session or session-less", async () => {
    const h = await boot();
    h.hire("acme.eng.lead", ACME_PROMPT, ACME);
    h.hire("acme.alice-research", "ALICE-PRIVATE", { orgId: "acme", userId: "alice" });
    expect((await h.open(MALLORY, "acme.eng.lead")).status).toBe(404);
    expect(await h.act(MALLORY, undefined, "whoami", { tag: "x" }, "acme.eng.lead")).toMatchObject({ http: 404 });
    expect((await h.open(BOB, "acme.alice-research")).status).toBe(404);
    expect(await h.act(BOB, undefined, "whoami", { tag: "x" }, "acme.alice-research")).toMatchObject({ http: 404 });
    expect((await h.open(ALICE, "acme.alice-research")).status).toBe(201);
  });

  it("E6 CLOSED the pin, not the address, decides", async () => {
    const h = await boot();
    h.hire("acme.x", "GLOBEX-OWNED", { orgId: "globex" });
    expect((await h.open(ALICE, "acme.x")).status).toBe(404);
    expect((await h.open(MALLORY, "acme.x")).status).toBe(201);
  });

  it("E8 CLOSED catalog per caller; anonymous sees shared flows only and still gets 200", async () => {
    const h = await boot();
    h.hire("acme.eng.lead", ACME_PROMPT, ACME);
    h.hire("acme.alice-research", "ALICE-PRIVATE", { orgId: "acme", userId: "alice" });
    const ids = async (who: Who | null) => {
      const r = await h.call("GET", [], who);
      return { status: r.status, ids: (r.json?.flows ?? []).map((f: any) => f.id).sort() };
    };
    expect(await ids(MALLORY)).toEqual({ status: 200, ids: ["app"] });
    expect(await ids(BOB)).toEqual({ status: 200, ids: ["acme.eng.lead", "app"] });
    expect(await ids(ALICE)).toEqual({ status: 200, ids: ["acme.alice-research", "acme.eng.lead", "app"] });
    expect(await ids(null)).toEqual({ status: 200, ids: ["app"] });
  });

  it("E9 CLOSED after release and re-hire under another pin, the old session is refused", async () => {
    const h = await boot();
    h.hire("acme.eng.lead", ACME_PROMPT, { orgId: "acme", userId: "alice" });
    const s = await h.open(ALICE, "acme.eng.lead");
    expect(h.state.unregister("acme.eng.lead")).toBe(true);
    h.hire("acme.eng.lead", "BOB-NOW", { orgId: "acme", userId: "bob" });
    const r = await h.act(ALICE, (s as any).id, "whoami", { tag: "rebound" }, "acme.eng.lead");
    expect(r.outcome ?? r.http).not.toBe("completed");
    expect(await h.seenIn("acme")).toEqual([]);
  });
});

describe("after · probes", () => {
  it("PROBE-A two users' private hires of the same seat name get distinct addresses", async () => {
    const stores = inMemoryStores();
    const row = (user: string) => ({ seatId: "research", flow: "seat", settings: {}, instructions: `${user}-PRIVATE`, owningOrgId: "acme", ownerUserId: user });
    await storeRow(stores, "acme", "~alice/research", row("alice"));
    await storeRow(stores, "acme", "~bob/research", row("bob"));
    const h = await boot(stores);
    const { seats, problems } = await reloadHiredSeats({ stores: h.runtime.stores, orgIds: ["acme"], kinds });
    console.log("PROBE-A seats", seats.map((s) => [s.id, s.ownerPin]), "problems", problems);
    const outcomes: string[] = [];
    for (const seat of seats) {
      try { h.state.register(seat); outcomes.push(`ok ${seat.id} ${JSON.stringify(seat.ownerPin)}`); }
      catch (e) { outcomes.push(`refused ${seat.id}: ${(e as Error).message}`); }
    }
    console.log("PROBE-A register", outcomes);
    // 01b29f0d: both minted "acme.research" and the second was refused.
    // fdca49fd: distinct user-owned addresses, and both register.
    expect(new Set(seats.map((s) => s.id)).size).toBe(seats.length);
    expect(outcomes.every((o) => o.startsWith("ok"))).toBe(true);
  });

  it("PROBE-B any flow that declares the private writer lists every user's private rows server-side", async () => {
    const stores = inMemoryStores();
    await storeRow(stores, "acme", "~alice/research", {
      seatId: "research", flow: "seat", settings: {}, instructions: "ALICE-PRIVATE", owningOrgId: "acme", ownerUserId: "alice",
    });
    const h = await boot(stores);
    const s = await h.open(BOB);
    expect(await h.act(BOB, (s as any).id, "peek", { tag: "peek" })).toEqual({ http: 202, outcome: "completed" });
    console.log("PROBE-B", await h.seenIn("acme"));
  });

  it("PROBE-B2 bob reading alice's private row by its exact key gets nothing", async () => {
    const stores = inMemoryStores();
    await storeRow(stores, "acme", "~alice/research", {
      seatId: "research", flow: "seat", settings: {}, instructions: "ALICE-PRIVATE", owningOrgId: "acme", ownerUserId: "alice",
    });
    const h = await boot(stores);
    const s = await h.open(BOB);
    const r = await h.act(BOB, (s as any).id, "peekAlice", { tag: "direct" });
    console.log("PROBE-B2", r, await h.seenIn("acme"));
  });

  it("PROBE-B4 debug listing of the private writer, with debug endpoints on", async () => {
    const stores = inMemoryStores();
    await storeRow(stores, "acme", "~alice/research", {
      seatId: "research", flow: "seat", settings: {}, instructions: "ALICE-PRIVATE", owningOrgId: "acme", ownerUserId: "alice",
    });
    const h = await boot(stores, { debugEndpointsEnabled: true });
    const s = await h.open(BOB);
    const r = await h.call("GET", ["sessions", (s as any).id, "debug", "resources", "privateRoster", "items"], BOB);
    console.log("PROBE-B4", r.status, JSON.stringify(r.json).slice(0, 300));
  });

  it("PROBE-C a deep pattern that misses the guard's one probe key is admitted", async () => {
    let refused: string | undefined;
    try {
      defineResourceCollection({ pattern: "workforce/roster/[owner]/notes", scope: "org", stateSchema: z.object({}) });
    } catch (e) {
      refused = (e as Error).message;
    }
    console.log("PROBE-C refused?", refused ?? "no — admitted");
  });
});
