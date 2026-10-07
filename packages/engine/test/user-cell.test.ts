/**
 * A user's data in one org, through real runs on the HTTP router.
 *
 * Every flow keeps what it saves for a user in that user's cell in the org
 * the run was admitted under: Alice in Acme and Alice in Globex never read
 * each other, Bob never reads Alice's, and inside one org the app's flows and
 * a hired worker (an instance registered with a pin) share her one cell, as
 * any two flows do. A child session on another flow keeps the user and org.
 * Every view of a session resolves the cell the run wrote, never a value
 * planted in another org's cell or in the cross-org cell older releases
 * wrote, and a refused caller writes nothing into any cell.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, dispatcher, handler } from "@flow-state-dev/core";
import type { FlowInstance, InstanceOwnerPin, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, createInMemoryStores, inMemoryStores, runAction } from "../src";
import { InstancePinMismatchError } from "../src/context/instance-pin";
import { getPersistedData } from "../src/resources/internal";
import { createMockModelResolver } from "@flow-state-dev/testing";

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

const noteInput = z.object({ tag: z.string(), marker: z.string() });
const tagInput = z.object({ tag: z.string() });

const resources = {
  /** Shared at user scope: the cell under test. */
  notes: defineResourceCollection({
    pattern: "notes/*",
    scope: "user",
    stateSchema: z.object({ marker: z.string() }),
    client: { state: { read: true } },
  }),
  /** Isolated to the flow: the user's cell in the org, plus the instance. */
  scratch: defineResourceCollection({
    pattern: "scratch/*",
    scope: "user",
    flowIsolation: true,
    stateSchema: z.object({ marker: z.string() }),
  }),
  /** Where a read records what it saw, so the check reads a real side effect. */
  seen: defineResourceCollection({
    pattern: "seen/*",
    scope: "org",
    stateSchema: z.object({ notes: z.array(z.string()), state: z.string().nullable() }),
  }),
};

const userConfig = {
  stateSchema: z.object({ marker: z.string().nullable().default(null) }),
  client: { derived: { mine: (ctx: { state: { marker: string | null } }) => ({ marker: ctx.state.marker }) } },
};

const save = handler({
  name: "save",
  inputSchema: noteInput,
  outputSchema: z.object({ ok: z.boolean() }),
  resources,
  execute: async (input, ctx) => {
    await (ctx.resources.notes as unknown as ResourceCollectionRef).create(input.tag, {
      marker: input.marker,
    });
    await (ctx.resources.scratch as unknown as ResourceCollectionRef).create(input.tag, {
      marker: input.marker,
    });
    await ctx.user.patchState({ marker: input.marker });
    return { ok: true };
  },
});

const read = handler({
  name: "read",
  inputSchema: tagInput,
  outputSchema: z.object({ ok: z.boolean() }),
  resources,
  execute: async (input, ctx) => {
    const rows = await (ctx.resources.notes as unknown as ResourceCollectionRef).list();
    await (ctx.resources.seen as unknown as ResourceCollectionRef).create(input.tag, {
      notes: rows.map((row) => String((row.state as { marker: string }).marker)),
      state: (ctx.user.state as { marker: string | null }).marker ?? null,
    });
    return { ok: true };
  },
});

/** A seat hands a save to the app flow, which has no pin, as a child session. */
const delegate = dispatcher({
  name: "delegate-to-app",
  type: "internal",
  flowKind: "app",
  action: "save",
  inputSchema: noteInput,
  session: { key: (input) => `delegated-${input.tag}` },
});

const actions = {
  save: { inputSchema: noteInput, block: save },
  read: { inputSchema: tagInput, block: read },
};

const seatKind = defineFlow({
  kind: "research",
  cardinality: "collection",
  resources,
  user: userConfig,
  actions: { ...actions, delegate: { inputSchema: noteInput, block: delegate } },
  authentication: verified,
});

/** A second kind that declares the same shared resource. */
const writerKind = defineFlow({
  kind: "writer",
  cardinality: "collection",
  resources,
  user: userConfig,
  actions,
  authentication: verified,
});

const appFlow = defineFlow({
  kind: "app",
  resources,
  user: userConfig,
  actions,
  internal: { actions: { save: { block: save } } },
  authentication: verified,
});

type Who = { user: string; org: string };
const ALICE_ACME: Who = { user: "alice", org: "acme" };
const ALICE_GLOBEX: Who = { user: "alice", org: "globex" };
const BOB_ACME: Who = { user: "bob", org: "acme" };

async function boot(options: { debug?: boolean } = {}) {
  const stores = inMemoryStores();
  const state = createFlowState({
    flows: { app: appFlow() },
    resolvePrincipal: verified.resolvePrincipal,
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({}),
    debugEndpointsEnabled: options.debug ?? false,
    debugAllowAnonymousLocal: true,
  });
  const router = (await state.getRouter()) as {
    GET: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
    POST: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
  };
  const runtime = await state.getRuntime();

  const call = async (method: "GET" | "POST", path: string[], who: Who, body?: unknown) => {
    const response = await router[method](
      new Request(`http://test/api/flows/${path.join("/")}`, {
        method,
        headers: {
          "content-type": "application/json",
          "x-verified-user": who.user,
          "x-verified-org": who.org,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } }
    );
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  const hire = (kind: typeof seatKind | typeof writerKind, id: string, pin: InstanceOwnerPin) =>
    state.register(kind({ id }) as unknown as FlowInstance, { pin });

  const open = async (who: Who, flowId: string): Promise<string> => {
    const opened = await call("POST", [flowId, "sessions"], who, { userId: who.user });
    expect(opened.status, `open ${flowId} as ${who.user}@${who.org}`).toBe(201);
    return opened.json.session.id as string;
  };

  const act = async (who: Who, flowId: string, sessionId: string, action: string, input: unknown) => {
    const posted = await call("POST", [flowId, sessionId, "actions", action], who, {
      userId: who.user,
      input,
    });
    expect(posted.status, `${action} on ${flowId} as ${who.user}@${who.org}`).toBe(202);
    const requestId = posted.json.request?.id as string;
    for (let i = 0; i < 200; i++) {
      const status = (await call("GET", [flowId, "requests", requestId, "status"], who)).json
        ?.status as string | undefined;
      if (status && !["pending", "in_progress", "running", "queued"].includes(status)) {
        expect(status, `${action} on ${flowId}`).toBe("completed");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`${action} on ${flowId} did not settle`);
  };

  /** Open a fresh session, run `read`, and return what the run saw. */
  const readAs = async (who: Who, flowId: string, tag: string) => {
    const sessionId = await open(who, flowId);
    await act(who, flowId, sessionId, "read", { tag });
    const row = await runtime.stores.resourceState.get("org", who.org, `seen/${tag}`);
    return row?.state as { notes: string[]; state: string | null };
  };

  /** Raw stored `notes/*` markers in one user-scope cell. */
  const cell = async (scopeId: string) =>
    Object.values(await runtime.stores.resourceState.getByPrefix("user", scopeId, "notes/")).map(
      (row) => (row as { state: { marker: string } }).state.marker
    );

  return { state, runtime, call, hire, open, act, readAs, cell };
}

describe("a user's cell in one org, for every flow", () => {
  it("keeps what Alice saves on the app flow in Acme, out of Globex and away from Bob (BR-1-BR-3)", async () => {
    const h = await boot();

    const session = await h.open(ALICE_ACME, "app");
    await h.act(ALICE_ACME, "app", session, "save", { tag: "a", marker: "ACME-M" });

    // BR-1: stored in her cell in Acme, state and both kinds of resource; the
    // cross-org cell older releases used is untouched.
    expect(await h.cell("alice:~org:acme")).toEqual(["ACME-M"]);
    expect(await h.cell("alice")).toEqual([]);
    expect((await h.runtime.stores.user.get("alice:~org:acme"))?.state).toEqual({ marker: "ACME-M" });
    expect(await h.runtime.stores.user.get("alice")).toBeUndefined();
    expect(
      Object.keys(await h.runtime.stores.resourceState.getByPrefix("user", "alice:~org:acme:app", "scratch/"))
    ).toEqual(["scratch/a"]);

    // BR-1: her next Acme run reads it back.
    expect(await h.readAs(ALICE_ACME, "app", "again")).toEqual({ notes: ["ACME-M"], state: "ACME-M" });
    // BR-2: the same flow in Globex starts empty.
    expect(await h.readAs(ALICE_GLOBEX, "app", "globex")).toEqual({ notes: [], state: null });
    // BR-3: Bob in Acme starts empty.
    expect(await h.readAs(BOB_ACME, "app", "bob")).toEqual({ notes: [], state: null });
  });

  it("keeps what Alice's Acme seat saves in her Acme cell, out of Globex and away from Bob", async () => {
    const h = await boot();
    h.hire(seatKind, "acme.~alice.research", { orgId: "acme", userId: "alice" });
    h.hire(seatKind, "globex.~alice.research", { orgId: "globex", userId: "alice" });
    h.hire(seatKind, "acme.~bob.research", { orgId: "acme", userId: "bob" });

    const session = await h.open(ALICE_ACME, "acme.~alice.research");
    await h.act(ALICE_ACME, "acme.~alice.research", session, "save", { tag: "a", marker: "ACME-M" });

    // BR-5: the cell a hired worker already used, byte for byte; its
    // flow-isolated data keys by her, Acme and the worker.
    expect(await h.cell("alice:~org:acme")).toEqual(["ACME-M"]);
    expect(await h.cell("alice")).toEqual([]);
    expect((await h.runtime.stores.user.get("alice:~org:acme"))?.state).toEqual({ marker: "ACME-M" });
    expect(
      Object.keys(
        await h.runtime.stores.resourceState.getByPrefix(
          "user",
          "alice:~org:acme:acme.~alice.research",
          "scratch/"
        )
      )
    ).toEqual(["scratch/a"]);

    expect(await h.readAs(ALICE_ACME, "acme.~alice.research", "again")).toEqual({
      notes: ["ACME-M"],
      state: "ACME-M",
    });
    expect(await h.readAs(ALICE_GLOBEX, "globex.~alice.research", "globex")).toEqual({
      notes: [],
      state: null,
    });
    expect(await h.readAs(BOB_ACME, "acme.~bob.research", "bob")).toEqual({ notes: [], state: null });
  });

  it("shares one cell between two flows in one org (BR-4)", async () => {
    const h = await boot();
    h.hire(seatKind, "acme.~alice.research", { orgId: "acme", userId: "alice" });
    h.hire(writerKind, "acme.~alice.writer", { orgId: "acme", userId: "alice" });
    const session = await h.open(ALICE_ACME, "acme.~alice.research");
    await h.act(ALICE_ACME, "acme.~alice.research", session, "save", { tag: "a", marker: "SHARED-M" });
    expect(await h.readAs(ALICE_ACME, "acme.~alice.writer", "writer")).toEqual({
      notes: ["SHARED-M"],
      state: "SHARED-M",
    });
  });

  it("stores Bob's use of an org-visible seat in his Acme cell", async () => {
    const h = await boot();
    h.hire(seatKind, "acme.eng.lead", { orgId: "acme" });
    const session = await h.open(BOB_ACME, "acme.eng.lead");
    await h.act(BOB_ACME, "acme.eng.lead", session, "save", { tag: "b", marker: "BOB-M" });
    expect(await h.cell("bob:~org:acme")).toEqual(["BOB-M"]);
    expect(await h.cell("bob")).toEqual([]);
    expect(await h.cell("alice:~org:acme")).toEqual([]);
    expect(await h.readAs(ALICE_ACME, "acme.eng.lead", "alice")).toEqual({ notes: [], state: null });
  });

  it("shares a user's cell between a hired worker and the app's flows in one org (BR-5)", async () => {
    const h = await boot();
    h.hire(seatKind, "acme.~alice.research", { orgId: "acme", userId: "alice" });
    h.hire(seatKind, "globex.~alice.research", { orgId: "globex", userId: "alice" });
    const app = await h.open(ALICE_ACME, "app");
    await h.act(ALICE_ACME, "app", app, "save", { tag: "app", marker: "APP-M" });

    // The worker reads what the app saved for her in Acme...
    expect(await h.readAs(ALICE_ACME, "acme.~alice.research", "seat")).toEqual({
      notes: ["APP-M"],
      state: "APP-M",
    });
    const seat = await h.open(ALICE_ACME, "acme.~alice.research");
    await h.act(ALICE_ACME, "acme.~alice.research", seat, "save", { tag: "s", marker: "SEAT-M" });
    // ...the app reads what the worker saved...
    expect(await h.readAs(ALICE_ACME, "app", "app-read")).toEqual({
      notes: ["APP-M", "SEAT-M"],
      state: "SEAT-M",
    });
    // ...and her Globex worker reads neither.
    expect(await h.readAs(ALICE_GLOBEX, "globex.~alice.research", "globex")).toEqual({
      notes: [],
      state: null,
    });
  });

  it("keeps the user and the org for a child session on another flow (BR-11)", async () => {
    const h = await boot();
    h.hire(seatKind, "acme.~alice.research", { orgId: "acme", userId: "alice" });
    const seat = await h.open(ALICE_ACME, "acme.~alice.research");
    await h.act(ALICE_ACME, "acme.~alice.research", seat, "delegate", {
      tag: "via-seat",
      marker: "DELEGATED-M",
    });
    for (let i = 0; i < 100 && (await h.cell("alice:~org:acme")).length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(await h.cell("alice:~org:acme")).toEqual(["DELEGATED-M"]);
    expect(await h.cell("alice")).toEqual([]);
    // The child read the app flow's isolated bucket in the same cell.
    expect(
      Object.keys(await h.runtime.stores.resourceState.getByPrefix("user", "alice:~org:acme:app", "scratch/"))
    ).toEqual(["scratch/via-seat"]);
  });
});

describe("the fence around the cell", () => {
  it("writes nothing into any cell for a caller outside the pin", async () => {
    const h = await boot();
    const seat = seatKind({ id: "acme.~alice.research" }) as unknown as FlowInstance;
    h.state.register(seat, { pin: { orgId: "acme", userId: "alice" } });
    const usersBefore = await h.runtime.stores.user.list();

    for (const [who, reason] of [[BOB_ACME, "owning-user"], [ALICE_GLOBEX, "owning-org"]] as const) {
      const refused = runAction({
        flow: seat,
        actionName: "save",
        input: { tag: "x", marker: "REFUSED-M" },
        userId: who.user,
        orgId: who.org,
        stores: h.runtime.stores,
        runtimeConfig: { modelResolver: createMockModelResolver({}) },
      });
      await expect(refused).rejects.toBeInstanceOf(InstancePinMismatchError);
      await expect(refused).rejects.toMatchObject({ reason });
    }

    expect(await h.runtime.stores.user.list()).toEqual(usersBefore);
    for (const scopeId of ["bob", "bob:~org:acme", "alice", "alice:~org:globex", "alice:~org:acme"]) {
      expect(await h.cell(scopeId), scopeId).toEqual([]);
    }
  });

  it.each([
    ["the app flow", "app", undefined],
    ["a hired worker", "acme.~alice.research", { orgId: "acme", userId: "alice" }],
  ] as const)(
    "resolves every read-side view of %s's session to the cell the run wrote (BR-10)",
    async (_label, flowId, pin) => {
      const h = await boot({ debug: true });
      if (pin !== undefined) h.hire(seatKind, flowId, pin);
      // Planted in the cross-org cell older releases wrote and in her Globex
      // cell: no view of an Acme session may return either.
      for (const scopeId of ["alice", "alice:~org:globex"]) {
        await h.runtime.stores.resourceState.set(
          "user",
          scopeId,
          "notes/planted",
          { marker: "PLANTED-M" },
          "any"
        );
        await h.runtime.stores.user.set(
          scopeId,
          { id: scopeId, userId: "alice", state: { marker: "PLANTED-M" }, resources: {}, version: 0, createdAt: 0, updatedAt: 0 },
          "any"
        );
      }

      const session = await h.open(ALICE_ACME, flowId);
      await h.act(ALICE_ACME, flowId, session, "save", { tag: "a", marker: "RUN-M" });

      const stateView = await h.call("GET", ["sessions", session, "state"], ALICE_ACME);
      expect(stateView.status).toBe(200);
      expect(stateView.json.clientData.user.mine).toEqual({ marker: "RUN-M" });

      const resourceView = await h.call("GET", ["sessions", session, "resources", "notes"], ALICE_ACME);
      expect(resourceView.status).toBe(200);
      const listed = JSON.stringify(resourceView.json);
      expect(listed).toContain("RUN-M");
      expect(listed).not.toContain("PLANTED-M");

      const debugView = await h.call(
        "GET",
        ["sessions", session, "debug", "resources", "notes", "items"],
        ALICE_ACME
      );
      expect(debugView.status).toBe(200);
      expect((debugView.json.items as { topic: string }[]).map((item) => item.topic)).toEqual(["a"]);
    }
  );

  it("reads no user data for a stored session with no org (BR-9)", async () => {
    const stores = createInMemoryStores();
    const flow = appFlow() as unknown as FlowInstance;
    for (const scopeId of ["alice", "alice:~org:acme"]) {
      await stores.resourceState.set("user", scopeId, "notes/planted", { marker: "PLANTED-M" }, "any");
    }
    await stores.session.set(
      "no-org",
      {
        id: "no-org",
        flowKind: "app",
        flowId: "app",
        userId: "alice",
        state: {},
        version: 0,
        createdAt: 0,
        updatedAt: 0,
        journal: [],
      },
      "any"
    );
    const registry = { get: () => flow } as unknown as Parameters<typeof getPersistedData>[0]["registry"];
    expect(await getPersistedData({ registry, stores }, flow, "no-org", "user")).toBeUndefined();
  });
});
