/**
 * FIX-1522 POC · org- and user-owned Workforce planes. Experimental evidence,
 * not a maintained test — run it with `run.sh` beside this file.
 *
 * Everything goes through the REAL `/api/flows` router with a verified-header
 * principal, so every isolation result below is the engine's own answer, not a
 * fixture's. Legs:
 *
 *   A  the owner key through hire → store → reload → registry
 *   B  seed pack → durable store, and what "seed once" needs
 *   C  isolation: user↔user, org↛user, drain, list, and the two leaks
 *   D  an org-hired bridge seat trying to reach a user plane
 *
 * Tests named `LEAK` or `MIS-FILE` assert what IS true today, not what should
 * be: they are the findings, pinned so a change that closes one shows up here.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { workerConfigSchema } from "../src/worker-config";
import { hireWorkforce } from "../src/hire";
import { reloadHiredSeats } from "../src/roster";
import { channelBoard } from "../src/channel/channel-board";
import { defineSeatInventoryCollection } from "../src/inventory";
import {
  assertOwnPlane,
  ownPlane,
  planeAddress,
  planeBoard,
  planeRosterCollection,
  planeRowKey,
  planeSeedLedger,
  reloadPlane,
  seedPlane,
  sessionPrincipal,
  type PlaneType,
  type SeedPack,
  type WorkforceOwner,
} from "./plane";

// ─── the app under test ────────────────────────────────────────────────────

const REF = {
  orgRoster: "orgRoster",
  userRoster: "userRoster",
  orgSeeded: "orgSeeded",
  userSeeded: "userSeeded",
  orgBoard: "eng.work",
  userBoard: "inbox.work",
  shippedBoard: "alice-desk.inbox.work",
  shippedSeats: "seats",
} as const;

const resources = {
  [REF.orgRoster]: planeRosterCollection("org"),
  [REF.userRoster]: planeRosterCollection("user"),
  [REF.orgSeeded]: planeSeedLedger("org"),
  [REF.userSeeded]: planeSeedLedger("user"),
  [REF.orgBoard]: planeBoard("org", REF.orgBoard),
  [REF.userBoard]: planeBoard("user", REF.userBoard),
  // The shipped declarations, unmodified — to see what they do on a user plane.
  [REF.shippedBoard]: channelBoard("alice-desk.inbox", "work"),
  [REF.shippedSeats]: defineSeatInventoryCollection(),
};

type Resources = { resources: Record<string, unknown> };
/** One declared collection by its map key — the single cast the handlers need. */
const collection = (ctx: Resources, ref: string) => ctx.resources[ref] as unknown as ResourceCollectionRef;
const rosterRef = (ctx: Resources, plane: PlaneType) =>
  collection(ctx, plane === "org" ? REF.orgRoster : REF.userRoster);
const boardRef = (ctx: Resources, plane: PlaneType) =>
  collection(ctx, plane === "org" ? REF.orgBoard : REF.userBoard);

const PACK: SeedPack = {
  id: "starter",
  version: 1,
  seats: [
    { seatId: "research.scout", flow: "clerk", instructions: "Find sources." },
    { seatId: "research.editor", flow: "clerk", instructions: "Tighten drafts." },
  ],
};

const plane = z.enum(["org", "user"]);
const owner = z.object({ type: plane, id: z.string() });
const ok = z.object({ ok: z.boolean() });

const hire = handler({
  name: "hire",
  inputSchema: z.object({ plane, seatId: z.string(), flow: z.string() }),
  outputSchema: ok,
  resources,
  execute: async (input, ctx) => {
    const { orgId } = sessionPrincipal(ctx);
    const key = planeRowKey(orgId, ownPlane(ctx, input.plane), input.seatId);
    await rosterRef(ctx, input.plane).create(key, { seatId: input.seatId, flow: input.flow, settings: {} });
    return { ok: true };
  },
});

const fire = handler({
  name: "fire",
  inputSchema: z.object({ plane, seatId: z.string() }),
  outputSchema: ok,
  resources,
  execute: async (input, ctx) => {
    const { orgId } = sessionPrincipal(ctx);
    await rosterRef(ctx, input.plane).delete(planeRowKey(orgId, ownPlane(ctx, input.plane), input.seatId));
    return { ok: true };
  },
});

const seed = handler({
  name: "seed",
  inputSchema: z.object({
    plane,
    strategy: z.enum(["create-if-absent", "ledgered"]),
    version: z.number().optional(),
  }),
  outputSchema: ok,
  resources,
  execute: async (input, ctx) => {
    const { orgId } = sessionPrincipal(ctx);
    const ledger = ctx.resources[input.plane === "org" ? REF.orgSeeded : REF.userSeeded] as unknown as ResourceRef<{
      packs: Record<string, { version: number; seededAt: string }>;
    }>;
    const pack = { ...PACK, version: input.version ?? PACK.version };
    await seedPlane(rosterRef(ctx, input.plane), ledger, orgId, ownPlane(ctx, input.plane), pack, input.strategy);
    return { ok: true };
  },
});

/**
 * File a task on a plane's board. `target` names the plane explicitly — which
 * is what a bridge would do — and `guard` decides whether `assertOwnPlane`
 * runs. With no target the session's own plane is used.
 */
const assign = handler({
  name: "assign",
  inputSchema: z.object({ plane, goal: z.string(), target: owner.optional(), guard: z.boolean() }),
  outputSchema: ok,
  resources,
  execute: async (input, ctx) => {
    const target: WorkforceOwner = input.target ?? ownPlane(ctx, input.plane);
    if (input.guard) assertOwnPlane(ctx, target);
    const id = `task-${input.goal}`;
    const now = Date.now();
    await boardRef(ctx, target.type).create(id, {
      id,
      goal: input.goal,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true };
  },
});

/** Complete every pending task the session can see on one plane's board. */
const drain = handler({
  name: "drain",
  inputSchema: z.object({ plane }),
  outputSchema: ok,
  resources,
  execute: async (input, ctx) => {
    for (const task of await boardRef(ctx, input.plane).list()) {
      if ((task.state as { status?: string }).status === "pending") {
        await task.patchState({ status: "completed", completedAt: Date.now() });
      }
    }
    return { ok: true };
  },
});

/**
 * What a user-owned channel does today with the SHIPPED doors: file a task on
 * its board (`channelBoard`) and register its seat (`defineSeatInventoryCollection`).
 */
const shipped = handler({
  name: "shipped",
  inputSchema: z.object({ goal: z.string(), seatId: z.string() }),
  outputSchema: ok,
  resources,
  execute: async (input, ctx) => {
    const now = Date.now();
    const board = collection(ctx, REF.shippedBoard);
    await board.create(`task-${input.goal}`, {
      id: `task-${input.goal}`, goal: input.goal, status: "pending", attempts: 0, createdAt: now, updatedAt: now,
    });
    const seats = collection(ctx, REF.shippedSeats);
    await seats.upsert(input.seatId, { id: input.seatId, kind: "clerk" });
    return { ok: true };
  },
});

const actions = {
  shipped: { inputSchema: shipped.inputSchema, block: shipped },
  hire: { inputSchema: hire.inputSchema, block: hire },
  fire: { inputSchema: fire.inputSchema, block: fire },
  seed: { inputSchema: seed.inputSchema, block: seed },
  assign: { inputSchema: assign.inputSchema, block: assign },
  drain: { inputSchema: drain.inputSchema, block: drain },
};

/** Identity from two verified headers — never from the body. Stands in for a real verifier. */
const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

const APP = "planes";
const appFlow = (auth: boolean) =>
  defineFlow({ kind: APP, resources, actions, ...(auth ? { authentication: verified } : {}) });

/** The seat kind a roster row names. It carries the same doors, so a hired seat can try them. */
const clerk = (auth: boolean) =>
  defineFlow({
    kind: "clerk",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    resources,
    actions,
    ...(auth ? { authentication: verified } : {}),
  });

// ─── the harness: the real router, driven over HTTP ────────────────────────

type Who = { user: string; org: string };
type Answer = { status: number; json: any };

async function boot(options: { auth?: boolean; stores?: ReturnType<typeof inMemoryStores> } = {}) {
  const auth = options.auth ?? true;
  const stores = options.stores ?? inMemoryStores();
  const state = createFlowState({
    flows: { [APP]: appFlow(auth)() },
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({}),
  });
  const router = (await state.getRouter()) as any;
  const runtime = await state.getRuntime();

  const call = async (method: "GET" | "POST", path: string[], who: Who, body?: unknown, extra = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", ...extra };
    if (auth) Object.assign(headers, { "x-verified-user": who.user, "x-verified-org": who.org });
    const response = await router[method](
      new Request(`http://test/api/flows/${path.join("/")}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } }
    );
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined } as Answer;
  };

  const open = async (who: Who, flowId = APP, bodyUser = who.user): Promise<string> => {
    const { status, json } = await call("POST", [flowId, "sessions"], who, { userId: bodyUser });
    if (status >= 400) throw new Error(`createSession ${status}: ${JSON.stringify(json)}`);
    return json.session?.id ?? json.id;
  };

  /**
   * Run one action to a terminal state. `outcome` is the request's final
   * status, or `"vanished"` when the POST was acked and the request id never
   * became readable — which is how a run refused at admission looks from
   * outside (see C2). `error` is the failing block's message, from the record.
   */
  const act = async (
    who: Who,
    sessionId: string,
    action: string,
    input: unknown,
    opts: { flowId?: string; bodyUser?: string } = {}
  ): Promise<{ http: number; outcome?: string; error?: string }> => {
    const flowId = opts.flowId ?? APP;
    const posted = await call("POST", [flowId, sessionId, "actions", action], who, {
      userId: opts.bodyUser ?? who.user,
      input,
    });
    if (posted.status >= 400) return { http: posted.status };
    const requestId = posted.json.request?.id;
    // A live request is itself unreadable for a few polls after its ack, so
    // "vanished" means still unreadable after the whole budget.
    for (let i = 0; i < 100; i++) {
      const polled = await call("GET", [flowId, "requests", requestId, "status"], who);
      const seen = polled.json?.status;
      if (seen && !["pending", "in_progress", "running", "queued"].includes(seen)) {
        const record = await runtime.stores.request.get(requestId);
        const failed = (record?.items ?? []).find((item: any) => item.error !== undefined) as any;
        return { http: posted.status, outcome: seen, error: failed?.error?.message };
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return { http: posted.status, outcome: "vanished" };
  };

  /** `act`, but a failure is a bug in the setup rather than a finding. */
  const must = async (...args: Parameters<typeof act>) => {
    const result = await act(...args);
    if (result.outcome !== "completed") throw new Error(`${args[2]}: ${JSON.stringify(result)}`);
  };

  /** The browser's door: the collection-state list route. */
  const read = (who: Who, sessionId: string, ref: string, extra: Record<string, string> = {}) =>
    call("GET", ["sessions", sessionId, "resources", ref], who, undefined, extra);

  /** What is physically in one cell, bypassing every door. */
  const cell = async (scope: "org" | "user", id: string, prefix: string) =>
    Object.keys(await runtime.stores.resourceState.getByPrefix(scope, id, prefix)).sort();

  return { state, runtime, call, open, act, must, read, cell };
}

const ALICE: Who = { user: "alice", org: "acme" };
const BOB: Who = { user: "bob", org: "acme" };
/** The org's service principal — what an org-hired seat runs as. */
const SVC: Who = { user: "svc", org: "acme" };

const clientSeatIds = (answer: Answer) => answer.json.items.map((item: any) => item.clientData?.seatId).sort();
const clientGoals = (answer: Answer) => answer.json.items.map((item: any) => item.clientData?.goal).sort();

// ─── A · the owner key through hire → store → reload → registry ───────────

describe("A · the owner key", () => {
  it("A1 one row schema, one prefix; the owner picks the cell", async () => {
    const h = await boot();
    const svc = await h.open(SVC);
    const alice = await h.open(ALICE);
    await h.must(SVC, svc, "hire", { plane: "org", seatId: "eng.lead", flow: "clerk" });
    await h.must(ALICE, alice, "hire", { plane: "user", seatId: "research.scout", flow: "clerk" });

    expect(await h.cell("org", "acme", "workforce/roster/")).toEqual(["workforce/roster/eng.lead"]);
    expect(await h.cell("user", "alice", "workforce/roster/")).toEqual(["workforce/roster/acme/research.scout"]);
    expect(await h.cell("user", "svc", "workforce/roster/")).toEqual([]);
  });

  it("A2 a reload per plane registers both seats, at addresses that cannot collide", async () => {
    const h = await boot();
    const svc = await h.open(SVC);
    const alice = await h.open(ALICE);
    await h.must(SVC, svc, "hire", { plane: "org", seatId: "eng.lead", flow: "clerk" });
    await h.must(ALICE, alice, "hire", { plane: "user", seatId: "research.scout", flow: "clerk" });

    const kinds = { clerk: clerk(true) };
    const org = await reloadPlane(h.runtime.stores, "acme", { type: "org", id: "acme" }, kinds);
    const user = await reloadPlane(h.runtime.stores, "acme", { type: "user", id: "alice" }, kinds);
    expect([...org.problems, ...user.problems]).toEqual([]);
    for (const seat of [...org.seats, ...user.seats]) h.state.register(seat);

    expect(org.seats.map((s) => s.id)).toEqual(["acme.eng.lead"]);
    expect(user.seats.map((s) => s.id)).toEqual(["acme.~alice.research.scout"]);
  });

  it("A3 an org row cannot borrow a user plane's address", () => {
    const org: WorkforceOwner = { type: "org", id: "acme" };
    expect(planeAddress("acme", { type: "user", id: "alice" }, "eng.lead")).toBe("acme.~alice.eng.lead");
    expect(() => planeAddress("acme", org, "~alice.eng.lead")).toThrow(/user plane/);
  });

  it("A4 an opaque principal id still makes a seat that reloads", async () => {
    // Principal ids are the host's, not folder names: dotted, `@`, `|`.
    expect(planeAddress("acme", { type: "user", id: "al.ice" }, "eng.lead")).toBe("acme.~al%2Eice.eng.lead");
    expect(planeAddress("acme", { type: "user", id: "al%2Eice" }, "eng.lead")).toBe("acme.~al%252%45ice.eng.lead");

    const EMAIL: Who = { user: "alice@example.com", org: "acme" };
    const h = await boot();
    const session = await h.open(EMAIL);
    await h.must(EMAIL, session, "hire", { plane: "user", seatId: "research.scout", flow: "clerk" });
    const reload = await reloadPlane(h.runtime.stores, "acme", { type: "user", id: EMAIL.user }, { clerk: clerk(true) });
    expect(reload.problems).toEqual([]);
    expect(reload.seats.map((s) => s.id)).toEqual(["acme.~alice%40example%2Ecom.research.scout"]);
  });
});

// ─── B · seed pack → durable store ─────────────────────────────────────────

describe("B · seed-then-evolve", () => {
  /** Seed, then evolve: fire one seeded seat, hire one of the user's own. Then "reboot" and seed again. */
  async function seedEvolveReseed(strategy: "create-if-absent" | "ledgered") {
    const h = await boot();
    const alice = await h.open(ALICE);
    await h.must(ALICE, alice, "seed", { plane: "user", strategy });
    await h.must(ALICE, alice, "fire", { plane: "user", seatId: "research.editor" });
    await h.must(ALICE, alice, "hire", { plane: "user", seatId: "research.critic", flow: "clerk" });
    await h.must(ALICE, alice, "seed", { plane: "user", strategy });
    return h;
  }

  it("B1 MIS-FILE create-if-absent resurrects a seat the user fired", async () => {
    const h = await seedEvolveReseed("create-if-absent");
    expect(await h.cell("user", "alice", "workforce/roster/acme/")).toEqual([
      "workforce/roster/acme/research.critic",
      "workforce/roster/acme/research.editor", // fired, and back
      "workforce/roster/acme/research.scout",
    ]);
  });

  it("B2 a per-plane seed ledger holds the evolved roster", async () => {
    const h = await seedEvolveReseed("ledgered");
    expect(await h.cell("user", "alice", "workforce/roster/acme/")).toEqual([
      "workforce/roster/acme/research.critic",
      "workforce/roster/acme/research.scout",
    ]);
  });

  it("B3 each plane seeds on its own first open, and only its own", async () => {
    const h = await boot();
    const alice = await h.open(ALICE);
    await h.must(ALICE, alice, "seed", { plane: "user", strategy: "ledgered" });
    expect(await h.cell("user", "bob", "workforce/roster/")).toEqual([]);
    expect(await h.cell("org", "acme", "workforce/roster/")).toEqual([]);

    const bob = await h.open(BOB);
    await h.must(BOB, bob, "seed", { plane: "user", strategy: "ledgered" });
    expect(await h.cell("user", "bob", "workforce/roster/")).toHaveLength(2);
  });

  it("B4 a user's plane in a second org seeds on its own first open", async () => {
    const h = await boot();
    await h.must(ALICE, await h.open(ALICE), "seed", { plane: "user", strategy: "ledgered" });
    const ALICE_GLOBEX: Who = { user: "alice", org: "globex" };
    await h.must(ALICE_GLOBEX, await h.open(ALICE_GLOBEX), "seed", { plane: "user", strategy: "ledgered" });
    expect(await h.cell("user", "alice", "workforce/roster/globex/")).toHaveLength(2);
  });

  it("B5 a bumped pack version is recorded and hires nothing", async () => {
    const h = await boot();
    const alice = await h.open(ALICE);
    await h.must(ALICE, alice, "seed", { plane: "user", strategy: "ledgered" });
    await h.must(ALICE, alice, "fire", { plane: "user", seatId: "research.editor" });
    await h.must(ALICE, alice, "seed", { plane: "user", strategy: "ledgered", version: 2 });

    expect(await h.cell("user", "alice", "workforce/roster/acme/")).toEqual(["workforce/roster/acme/research.scout"]);
    const stored = await h.runtime.stores.resourceState.getByPrefix("user", "alice", "workforce-seeded");
    const packs = Object.values(stored).map((entry) => (entry.state as any).packs);
    expect(packs).toEqual([{ "acme/starter": { version: 2, seededAt: expect.any(String) } }]);
  });
});

// ─── C · isolation ─────────────────────────────────────────────────────────

describe("C · isolation", () => {
  it("C1 user↔user list: bob reads only bob's plane, whatever he claims", async () => {
    const h = await boot();
    const alice = await h.open(ALICE);
    const bob = await h.open(BOB, APP, "alice"); // body claims alice
    await h.must(ALICE, alice, "hire", { plane: "user", seatId: "research.scout", flow: "clerk" });
    await h.must(BOB, bob, "hire", { plane: "user", seatId: "ops.pager", flow: "clerk" });

    const seen = await h.read(BOB, bob, REF.userRoster, { "x-user-id": "alice" });
    expect(seen.status).toBe(200);
    expect(clientSeatIds(seen)).toEqual(["ops.pager"]);
  });

  it("C2 user↔user session: bob cannot read alice's session, and his action there does nothing", async () => {
    const h = await boot();
    const alice = await h.open(ALICE);
    expect((await h.read(BOB, alice, REF.userRoster)).status).toBe(403);

    // QUIET: acked 202, then refused at admission (`UserBindingMismatchError`)
    // before a request record exists — nothing written, nothing to poll.
    const posted = await h.act(BOB, alice, "hire", { plane: "user", seatId: "x.y", flow: "clerk" });
    expect(posted).toEqual({ http: 202, outcome: "vanished" });
    expect(await h.cell("user", "alice", "workforce/roster/")).toEqual([]);
    expect(await h.cell("user", "bob", "workforce/roster/")).toEqual([]);
  });

  it("C3 MIS-FILE org↛user assign: unguarded, it lands in the CALLER's cell, silently", async () => {
    const h = await boot();
    const svc = await h.open(SVC);
    const alice = await h.open(ALICE);
    const result = await h.act(SVC, svc, "assign", {
      plane: "user",
      goal: "for-alice",
      target: { type: "user", id: "alice" },
      guard: false,
    });
    expect(result.outcome).toBe("completed"); // no refusal…
    expect(clientGoals(await h.read(ALICE, alice, REF.userBoard))).toEqual([]); // …alice never sees it…
    expect(clientGoals(await h.read(SVC, svc, REF.userBoard))).toEqual(["for-alice"]); // …svc's own cell has it
  });

  it("C4 org↛user assign, guarded: refused by name", async () => {
    const h = await boot();
    const svc = await h.open(SVC);
    const result = await h.act(SVC, svc, "assign", {
      plane: "user",
      goal: "for-alice",
      target: { type: "user", id: "alice" },
      guard: true,
    });
    expect(result.outcome).toBe("failed");
    expect(result.error).toContain("plane user:alice is not this session's");
    expect(await h.cell("user", "svc", "")).toEqual([]);
  });

  it("C5 drain: an org session's drain cannot reach a user board's rows", async () => {
    const h = await boot();
    const svc = await h.open(SVC);
    const alice = await h.open(ALICE);
    await h.must(ALICE, alice, "assign", { plane: "user", goal: "mine", guard: true });

    await h.must(SVC, svc, "drain", { plane: "user" });
    const afterSvc = await h.read(ALICE, alice, REF.userBoard);
    expect(afterSvc.json.items.map((i: any) => i.clientData.status)).toEqual(["pending"]);

    await h.must(ALICE, alice, "drain", { plane: "user" });
    const afterAlice = await h.read(ALICE, alice, REF.userBoard);
    expect(afterAlice.json.items.map((i: any) => i.clientData.status)).toEqual(["completed"]);
  });

  it("C6 org list: the org roster never carries a user plane's seats", async () => {
    const h = await boot();
    const alice = await h.open(ALICE);
    await h.must(ALICE, alice, "hire", { plane: "user", seatId: "research.scout", flow: "clerk" });
    expect(clientSeatIds(await h.read(BOB, await h.open(BOB), REF.orgRoster))).toEqual([]);
  });

  it("C7 LEAK the browser read of a user plane spans every org the user is in", async () => {
    const h = await boot();
    const inAcme = await h.open(ALICE);
    await h.must(ALICE, inAcme, "hire", { plane: "user", seatId: "research.scout", flow: "clerk" });

    // Same person, signed into a different org.
    const ALICE_GLOBEX: Who = { user: "alice", org: "globex" };
    const inGlobex = await h.open(ALICE_GLOBEX);
    const seen = await h.read(ALICE_GLOBEX, inGlobex, REF.userRoster);
    // The key keeps boot reload per-org (A1/A2), but the read route lists the
    // whole user cell: there is no (user × org) cell in the engine.
    expect(seen.json.items.map((i: any) => i.topic)).toEqual(["acme/research.scout"]);
    expect(clientSeatIds(seen)).toEqual(["research.scout"]);
  });

  it("C8 LEAK the flow catalog lists every registered seat to everyone", async () => {
    const h = await boot();
    const alice = await h.open(ALICE);
    await h.must(ALICE, alice, "hire", { plane: "user", seatId: "research.scout", flow: "clerk" });
    const { seats } = await reloadPlane(h.runtime.stores, "acme", { type: "user", id: "alice" }, { clerk: clerk(true) });
    for (const seat of seats) h.state.register(seat);

    // Bob, and a principal from another org entirely.
    for (const who of [BOB, { user: "mallory", org: "globex" }]) {
      const catalog = await h.call("GET", [], who);
      expect(catalog.status).toBe(200);
      expect(catalog.json.flows.map((f: any) => f.id)).toContain("acme.~alice.research.scout");
    }
  });
});

describe("C′ · the shipped channel doors, used from a user plane", () => {
  it("C9 LEAK a channel board is org-scoped whoever owns the channel", async () => {
    const h = await boot();
    const alice = await h.open(ALICE);
    await h.must(ALICE, alice, "shipped", { goal: "private-plan", seatId: "acme.~alice.research.scout" });
    const bob = await h.open(BOB);
    expect(clientGoals(await h.read(BOB, bob, REF.shippedBoard))).toEqual(["private-plan"]);
  });

  it("C10 LEAK the seat inventory is org-scoped, so a user seat registers org-wide", async () => {
    const h = await boot();
    const alice = await h.open(ALICE);
    await h.must(ALICE, alice, "shipped", { goal: "g", seatId: "acme.~alice.research.scout" });
    expect(await h.cell("org", "acme", "inventory/seats/")).toEqual(["inventory/seats/acme.~alice.research.scout"]);
    expect(await h.cell("user", "alice", "inventory/")).toEqual([]);
  });
});

// ─── D · the bridge seat ───────────────────────────────────────────────────

describe("D · an org-hired bridge seat reaching a user plane", () => {
  /** Hire the bridge on the org plane, reload it, register it: a real seat. */
  async function withBridge() {
    const h = await boot();
    const svc = await h.open(SVC);
    await h.must(SVC, svc, "hire", { plane: "org", seatId: "bridge.alice", flow: "clerk" });
    const { seats } = await reloadPlane(h.runtime.stores, "acme", { type: "org", id: "acme" }, { clerk: clerk(true) });
    for (const seat of seats) h.state.register(seat);
    return { h, bridgeId: seats[0]!.id };
  }

  it("D1 MIS-FILE the bridge's own session writes to its own principal's cell", async () => {
    const { h, bridgeId } = await withBridge();
    expect(bridgeId).toBe("acme.bridge.alice");
    const bridge = await h.open(SVC, bridgeId);
    const alice = await h.open(ALICE);

    const result = await h.act(SVC, bridge, "assign", {
      plane: "user", goal: "via-bridge", target: { type: "user", id: "alice" }, guard: false,
    }, { flowId: bridgeId });
    expect(result.outcome).toBe("completed");
    expect(clientGoals(await h.read(ALICE, alice, REF.userBoard))).toEqual([]);
    expect(await h.cell("user", "svc", "")).toEqual(expect.arrayContaining([expect.stringContaining("via-bridge")]));
  });

  it("D2 the bridge's own flow cannot act inside alice's session", async () => {
    const { h, bridgeId } = await withBridge();
    const alice = await h.open(ALICE);

    // Alice's app session, addressed through the bridge instance: refused
    // loudly, because a session belongs to the instance that created it.
    const intoApp = await h.act(SVC, alice, "assign", { plane: "user", goal: "a", guard: true }, { flowId: bridgeId });
    expect(intoApp).toEqual({ http: 409 });

    // A session alice opened ON the bridge seat: the instance matches, and the
    // run is refused at admission because the session is alice's, not svc's.
    const aliceOnBridge = await h.open(ALICE, bridgeId);
    const intoBridge = await h.act(SVC, aliceOnBridge, "assign", { plane: "user", goal: "b", guard: true }, { flowId: bridgeId });
    expect(intoBridge).toEqual({ http: 202, outcome: "vanished" });

    expect(await h.cell("user", "alice", "")).toEqual([]);
  });

  it("D3 claiming alice in the body changes nothing under verified identity", async () => {
    const { h, bridgeId } = await withBridge();
    const alice = await h.open(ALICE);
    const aliceOnBridge = await h.open(ALICE, bridgeId);
    const intoAlice = await h.act(SVC, aliceOnBridge, "assign", { plane: "user", goal: "x", guard: true }, {
      flowId: bridgeId,
      bodyUser: "alice",
    });
    expect(intoAlice).toEqual({ http: 202, outcome: "vanished" });

    // Its own session, created while claiming to be alice, is still svc's.
    const bridge = await h.open(SVC, bridgeId, "alice");
    await h.must(SVC, bridge, "assign", { plane: "user", goal: "y", guard: false }, { flowId: bridgeId, bodyUser: "alice" });
    expect(clientGoals(await h.read(ALICE, alice, REF.userBoard))).toEqual([]);
  });

  it("D4 without verified identity the bridge 'works' — by impersonating alice", async () => {
    // Registered by hand: an unauthenticated app's org is `DEFAULT_ORG_ID`,
    // which cannot be an address segment (X1). The question here is identity.
    const h = await boot({ auth: false });
    const bridgeId = "default.bridge.alice";
    h.state.register(hireWorkforce([{ id: bridgeId, declared: { flow: "clerk" }, body: "" }], { kinds: { clerk: clerk(false) } })[0]!);
    const alice = await h.open({ user: "alice", org: "default" });
    // The bridge's session, created claiming to be alice.
    const bridge = await h.open(SVC, bridgeId, "alice");
    await h.must(SVC, bridge, "assign", { plane: "user", goal: "via-bridge", guard: true }, {
      flowId: bridgeId,
      bodyUser: "alice",
    });
    expect(clientGoals(await h.read({ user: "alice", org: "default" }, alice, REF.userBoard))).toEqual(["via-bridge"]);
  });
});

// ─── X · side finding, outside the owner question ─────────────────────────

describe("X · found on the way", () => {
  it("X1 a runtime hire under DEFAULT_ORG_ID is written, then fails the whole boot's reload", async () => {
    const h = await boot({ auth: false });
    const session = await h.open({ user: "dev", org: "default" });
    await h.must({ user: "dev", org: "default" }, session, "hire", { plane: "org", seatId: "eng.lead", flow: "clerk" });
    expect(await h.cell("org", DEFAULT_ORG_ID, "workforce/roster/")).toEqual(["workforce/roster/eng.lead"]);

    // Not a skipped row: `seatAddress` throws for a bad ORG by design, so the
    // reload rejects and no org's seats come back.
    await expect(
      reloadHiredSeats({ stores: h.runtime.stores, orgIds: [DEFAULT_ORG_ID], kinds: { clerk: clerk(false) } })
    ).rejects.toThrow(`Organization id "${DEFAULT_ORG_ID}" must be lowercase`);
  });
});
