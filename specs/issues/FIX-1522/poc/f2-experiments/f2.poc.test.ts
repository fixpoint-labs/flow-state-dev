/**
 * FIX-1522 POC · the F2 experiments, run against today's code (no fix).
 * Experimental evidence, not a maintained test — run it with `run.sh`.
 *
 * `F2-PLAN.md` lists nine experiments. Each one here is its "before" leg: it
 * pins what happens on `main` today, through the REAL `/api/flows` router under
 * a verified principal. Names ending in `HOLE` assert a path that works today
 * and must be refused once FIX-1529 lands, so the fix shows up as a red test.
 * Names ending in `DECIDES` settle a design question rather than pin a hole.
 *
 * Legs that only mean something against the fix (E6 pin-vs-address, E8's
 * anonymous catalog) are not here; see the README.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, dispatcher, handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { hireWorkforce } from "../src/hire";
import { defineHiredRosterCollection, reloadHiredSeats } from "../src/roster";
import { workerConfigSchema } from "../src/worker-config";

// ─── the app: one app flow, one seat kind, and the shipped roster ─────────

const readable = { client: { state: { read: true } } } as const;

const resources = {
  /** What a seat's run reveals about the seat it ran as. Org scope: lands in the CALLER's org. */
  seen: defineResourceCollection({
    pattern: "seen/*",
    scope: "org",
    stateSchema: z.object({ instance: z.string(), as: z.string(), instructions: z.string().nullable() }),
    ...readable,
  }),
  /** The shipped FIX-1475 roster collection, exactly as a host declares it. */
  roster: defineHiredRosterCollection(),
};

const tagInput = z.object({ tag: z.string() });

/** Runs as whatever instance it was addressed through, and records that instance's config. */
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

/** E7: the app flow hands work to acme's seat over the framework's own cross-flow seam. */
const handToAcmeSeat = dispatcher({
  name: "hand-to-acme-seat",
  type: "internal",
  flowKind: "acme.eng.lead",
  action: "whoami",
  inputSchema: tagInput,
  session: { key: (input) => input.tag },
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
  resources,
  actions: {
    whoami: { inputSchema: tagInput, block: whoami },
    hand: { inputSchema: tagInput, block: handToAcmeSeat },
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

// ─── harness ───────────────────────────────────────────────────────────────

type Who = { user: string; org: string };
type Answer = { status: number; json: any };
type Stores = ReturnType<typeof inMemoryStores>;

/** One process. Pass the same `stores` to a second boot to model a restart. */
async function boot(stores: Stores = inMemoryStores()) {
  const state = createFlowState({
    flows: { [APP]: appFlow() },
    resolvePrincipal: verified.resolvePrincipal,
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({}),
  });
  const router = (await state.getRouter()) as any;
  const runtime = await state.getRuntime();

  const call = async (method: "GET" | "POST", path: string[], who: Who, body?: unknown): Promise<Answer> => {
    const response = await router[method](
      new Request(`http://test/api/flows/${path.join("/")}`, {
        method,
        headers: { "content-type": "application/json", "x-verified-user": who.user, "x-verified-org": who.org },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } }
    );
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  const open = async (who: Who, flowId = APP): Promise<string> => {
    const { status, json } = await call("POST", [flowId, "sessions"], who, { userId: who.user });
    if (status >= 400) throw new Error(`createSession ${status}: ${JSON.stringify(json)}`);
    return json.session?.id ?? json.id;
  };

  /** Run one action; the outcome is the final status, or `vanished` / the HTTP refusal. */
  const act = async (who: Who, sessionId: string | undefined, action: string, input: unknown, flowId = APP) => {
    const path = sessionId === undefined ? [flowId, "actions", action] : [flowId, sessionId, "actions", action];
    const posted = await call("POST", path, who, { userId: who.user, input });
    if (posted.status >= 400) return { http: posted.status, error: posted.json?.error as string | undefined };
    const requestId = posted.json.request?.id;
    for (let i = 0; i < 100; i++) {
      const seen = (await call("GET", [flowId, "requests", requestId, "status"], who)).json?.status;
      if (seen && !["pending", "in_progress", "running", "queued"].includes(seen)) return { http: posted.status, outcome: seen };
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return { http: posted.status, outcome: "vanished" };
  };

  /** Every `seen/*` row in one org's cell. */
  const seenIn = async (org: string) =>
    Object.values(await runtime.stores.resourceState.getByPrefix("org", org, "seen/")).map((row: any) => row.state);

  /** Wait for a fire-and-forget dispatch to land a row in an org's cell. */
  const settle = async (org: string, rows: number) => {
    for (let i = 0; i < 200 && (await seenIn(org)).length < rows; i++) await new Promise((r) => setTimeout(r, 5));
  };

  /** Register a seat the way a hire does: an instance of the seat kind carrying its org's instructions. */
  const hireSeat = (address: string, instructions: string) =>
    state.register(hireWorkforce([{ id: address, declared: { flow: "seat" }, body: instructions }], { kinds })[0]!);

  return { state, runtime, stores, call, open, act, seenIn, settle, hireSeat };
}

/** Write one roster row straight into an org's cell, as a past hire would have. */
const storeRow = async (stores: Stores, org: string, key: string, row: Record<string, unknown>) =>
  (await stores.resolve(["primary"])).resourceState!.set("org", org, `workforce/roster/${key}`, row as any, "any");

const ALICE: Who = { user: "alice", org: "acme" };
const BOB: Who = { user: "bob", org: "acme" };
const MALLORY: Who = { user: "mallory", org: "globex" };
const ACME_PROMPT = "ACME-CONFIDENTIAL: you work on acme's roadmap";

// ─── E3 · wrong-org restart ───────────────────────────────────────────────

describe("E3 · wrong-org restart", () => {
  it("E3 HOLE a cross-org session opened before the fix keeps running acme's seat after a restart", async () => {
    // Process 1: acme hires its lead; mallory@globex opens a session on it (F2).
    const stores = inMemoryStores();
    await storeRow(stores, "acme", "eng.lead", { seatId: "eng.lead", flow: "seat", settings: {}, instructions: ACME_PROMPT });
    const first = await boot(stores);
    const { seats } = await reloadHiredSeats({ stores: first.runtime.stores, orgIds: ["acme"], kinds });
    seats.forEach((seat) => first.state.register(seat));
    const onAcmeSeat = await first.open(MALLORY, "acme.eng.lead");

    // Process 2: same stores, seat brought back by the shipped reload path.
    const second = await boot(stores);
    const reloaded = await reloadHiredSeats({ stores: second.runtime.stores, orgIds: ["acme"], kinds });
    expect(reloaded.seats.map((seat) => seat.id)).toEqual(["acme.eng.lead"]);
    reloaded.seats.forEach((seat) => second.state.register(seat));

    // mallory resumes the session she opened before the restart. Nothing on the
    // resume path compares her org to the seat's owner — the session was bound
    // to globex at creation and admission only checks session ↔ principal.
    expect(await second.act(MALLORY, onAcmeSeat, "whoami", { tag: "after-restart" }, "acme.eng.lead")).toEqual({
      http: 202,
      outcome: "completed",
    });
    expect(await second.seenIn("globex")).toEqual([{ instance: "acme.eng.lead", as: "mallory@globex", instructions: ACME_PROMPT }]);
    expect(await second.seenIn("acme")).toEqual([]);

    // Control: the resume path DOES run admission. bob@acme resuming mallory's
    // session is refused (after the 202 ack), so what lets mallory through is
    // the missing instance ↔ owner check, not a missing admission step.
    expect(await second.act(BOB, onAcmeSeat, "whoami", { tag: "bob" }, "acme.eng.lead")).toEqual({ http: 202, outcome: "vanished" });
  });
});

// ─── E7 · soft-mix through the dispatch seam ──────────────────────────────

describe("E7 · soft-mix through dispatch", () => {
  it("E7 HOLE a globex session hands work to acme's seat, and the child runs with acme's instructions", async () => {
    const h = await boot();
    h.hireSeat("acme.eng.lead", ACME_PROMPT);
    // An ordinary app action in mallory's globex session. It never opens a
    // session on the seat itself — the framework's cross-flow seam does.
    expect(await h.act(MALLORY, await h.open(MALLORY), "hand", { tag: "handed" })).toEqual({ http: 202, outcome: "completed" });
    await h.settle("globex", 1);

    // The child session ran as acme's seat, bound to mallory's principal.
    expect(await h.seenIn("globex")).toEqual([{ instance: "acme.eng.lead", as: "mallory@globex", instructions: ACME_PROMPT }]);
    expect(await h.seenIn("acme")).toEqual([]);
  });
});

// ─── E4 · does the roster's browser read honour its pattern? ──────────────

describe("E4 · the open wall", () => {
  it("E4 DECIDES a private sub-prefix row stays out of the org roster's browser read, and in the reload", async () => {
    const stores = inMemoryStores();
    await storeRow(stores, "acme", "eng.lead", { seatId: "eng.lead", flow: "seat", settings: {}, instructions: ACME_PROMPT });
    // Alice's user-owned hire, in the same org cell under a nested key the
    // collection's single-segment `workforce/roster/*` should not match.
    await storeRow(stores, "acme", "~alice/research", {
      seatId: "research",
      flow: "seat",
      settings: {},
      instructions: "ALICE-PRIVATE: my research assistant",
    });
    // Control: the same private row at a FLAT key. If the route listed by
    // prefix rather than pattern, both private rows would come back.
    await storeRow(stores, "acme", "alice-flat", {
      seatId: "alice-flat",
      flow: "seat",
      settings: {},
      instructions: "ALICE-FLAT: listed, because one segment matches",
    });
    const h = await boot(stores);

    // bob@acme lists the roster through the browser route the collection opens.
    const listed = await h.call("GET", ["sessions", await h.open(BOB), "resources", "roster"], BOB);
    expect(listed.status).toBe(200);
    const instructions = (listed.json.items ?? []).map((item: any) => item.clientData?.instructions).sort();
    expect(instructions).toEqual([ACME_PROMPT, "ALICE-FLAT: listed, because one segment matches"]);

    // The per-org reload still sees both rows with its one prefix read — option 1's other premise.
    const raw = await h.runtime.stores.resourceState.getByPrefix("org", "acme", "workforce/roster/");
    expect(Object.keys(raw).sort()).toEqual([
      "workforce/roster/alice-flat",
      "workforce/roster/eng.lead",
      "workforce/roster/~alice/research",
    ]);
  });
});

// ─── the other "before" legs ──────────────────────────────────────────────

describe("before · the rest", () => {
  it("E1 HOLE another org's user opens a session on acme's seat, is acked 202, and runs it", async () => {
    const h = await boot();
    h.hireSeat("acme.eng.lead", ACME_PROMPT);
    // Session-less action, the form F2-PLAN (d) must refuse before the ack.
    expect(await h.act(MALLORY, undefined, "whoami", { tag: "sessionless" }, "acme.eng.lead")).toEqual({
      http: 202,
      outcome: "completed",
    });
    expect(await h.seenIn("globex")).toEqual([{ instance: "acme.eng.lead", as: "mallory@globex", instructions: ACME_PROMPT }]);
  });

  it("E2 HOLE a member of the same org opens and runs another member's user-owned seat", async () => {
    const h = await boot();
    // Today there is no user-owned seat: this is alice's hire in name only.
    h.hireSeat("acme.~alice.research", "ALICE-PRIVATE: my research assistant");
    const onAlicesSeat = await h.open(BOB, "acme.~alice.research");
    expect(await h.act(BOB, onAlicesSeat, "whoami", { tag: "bob" }, "acme.~alice.research")).toEqual({
      http: 202,
      outcome: "completed",
    });
    expect(await h.seenIn("acme")).toEqual([
      { instance: "acme.~alice.research", as: "bob@acme", instructions: "ALICE-PRIVATE: my research assistant" },
    ]);
  });

  it("E5 HOLE a row that names another org reloads under the cell's org, the claim silently dropped", async () => {
    const stores = inMemoryStores();
    await storeRow(stores, "acme", "eng.lead", {
      seatId: "eng.lead",
      flow: "seat",
      settings: {},
      instructions: ACME_PROMPT,
      owningOrgId: "globex",
    });
    const h = await boot(stores);
    const { seats, problems } = await reloadHiredSeats({ stores: h.runtime.stores, orgIds: ["acme"], kinds });
    expect(problems).toEqual([]);
    expect(seats.map((seat) => seat.id)).toEqual(["acme.eng.lead"]);
  });

  it("E8 HOLE the catalog lists acme's seat to globex and alice's seat to bob", async () => {
    const h = await boot();
    h.hireSeat("acme.eng.lead", ACME_PROMPT);
    h.hireSeat("acme.~alice.research", "ALICE-PRIVATE");
    const ids = async (who: Who) => (await h.call("GET", [], who)).json.flows.map((f: any) => f.id).sort();
    expect(await ids(MALLORY)).toContain("acme.eng.lead");
    expect(await ids(BOB)).toContain("acme.~alice.research");
  });

  it("E9 HOLDS a held address refuses a second registration; a released one takes any config", async () => {
    const h = await boot();
    h.hireSeat("acme.eng.lead", ACME_PROMPT);
    // While held: refused already, whatever the pin would have said.
    expect(() => h.hireSeat("acme.eng.lead", "GLOBEX: rebind")).toThrow();

    // Released, then taken by a different config. alice's open session on the
    // address now runs the new one: the address, not the owner, is the key.
    const alices = await h.open(ALICE, "acme.eng.lead");
    expect(h.state.unregister("acme.eng.lead")).toBe(true);
    h.hireSeat("acme.eng.lead", "GLOBEX: rebind");
    expect(await h.act(ALICE, alices, "whoami", { tag: "rebound" }, "acme.eng.lead")).toEqual({ http: 202, outcome: "completed" });
    expect(await h.seenIn("acme")).toEqual([{ instance: "acme.eng.lead", as: "alice@acme", instructions: "GLOBEX: rebind" }]);
  });
});
