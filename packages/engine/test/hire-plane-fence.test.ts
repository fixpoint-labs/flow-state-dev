/**
 * FIX-1529 hire-plane fence, through the real router.
 *
 * Each leg is a falsifier from the F2 before suite. The before assertions
 * described the hole (202, the prompt runs, the catalog lists it). These
 * assert the hole is closed. A shared app flow stays listed and runnable.
 * The pin is the register() argument, never the address.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResourceCollection,
  dispatcher,
  handler,
} from "@flow-state-dev/core";
import {
  HIRED_ROSTER_PRIVATE_PATTERN,
  markHiredRosterPrivateCollection,
  type ResourceCollectionRef,
} from "@flow-state-dev/core/types";
import { createFlowRegistry, createFlowState, inMemoryStores, runAction } from "../src";
import { InstancePinMismatchError } from "../src/context/hire-plane";
import { createMockModelResolver } from "@flow-state-dev/testing";

const readable = { client: { state: { read: true } } } as const;
const tagInput = z.object({ tag: z.string() });

const resources = {
  seen: defineResourceCollection({
    pattern: "seen/*",
    scope: "org",
    stateSchema: z.object({
      instance: z.string(),
      as: z.string(),
      instructions: z.string().nullable(),
    }),
    ...readable,
  }),
  roster: defineResourceCollection({
    pattern: "workforce/roster/*",
    scope: "org",
    flowIsolation: false,
    stateSchema: z.object({
      seatId: z.string(),
      instructions: z.string().nullable(),
    }),
    client: { state: { read: true }, expose: ["seatId", "instructions"] },
  }),
};

const whoami = handler({
  name: "whoami",
  inputSchema: tagInput,
  outputSchema: z.object({ ok: z.boolean() }),
  resources,
  execute: async (input, ctx) => {
    const seen = ctx.resources.seen as unknown as ResourceCollectionRef;
    const config = ctx.flow.config as { instructions?: string };
    const instance = (ctx.flow as { id: string }).id;
    const { userId = "", orgId = "" } = ctx.session.identity;
    await seen.create(input.tag, {
      instance,
      as: `${userId}@${orgId}`,
      instructions: config.instructions ?? null,
    });
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

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

const seatKind = defineFlow({
  kind: "seat",
  cardinality: "collection",
  configSchema: z.object({ instructions: z.string().nullable().default(null) }),
  resources,
  actions: { whoami: { inputSchema: tagInput, block: whoami } },
  internal: { actions: { whoami: { block: whoami } } },
  authentication: verified,
});

const privateRoster = markHiredRosterPrivateCollection(
  defineResourceCollection({
    pattern: HIRED_ROSTER_PRIVATE_PATTERN,
    scope: "org",
    flowIsolation: false,
    stateSchema: z.object({ instructions: z.string() }),
  }),
);

const peekBrowser = handler({
  name: "peek-browser",
  inputSchema: tagInput,
  outputSchema: z.object({ ok: z.boolean() }),
  resources,
  execute: async (input, ctx) => {
    const ref = ctx.resources.roster as unknown as ResourceCollectionRef;
    let got: string;
    try {
      const row = await ref.getOptional("~alice/research");
      got = row === undefined ? "undefined" : String(row.state.instructions ?? "");
    } catch (error) {
      got = `threw: ${(error as Error).message}`;
    }
    const seen = ctx.resources.seen as unknown as ResourceCollectionRef;
    const { userId = "", orgId = "" } = ctx.session.identity;
    await seen.create(input.tag, {
      instance: "peek-browser",
      as: `${userId}@${orgId}`,
      instructions: got,
    });
    return { ok: true };
  },
});

const peekPrivate = handler({
  name: "peek-private",
  inputSchema: tagInput,
  outputSchema: z.object({ ok: z.boolean() }),
  resources: { ...resources, privateRoster },
  execute: async (input, ctx) => {
    const rows = await (ctx.resources.privateRoster as unknown as ResourceCollectionRef).list();
    const seen = ctx.resources.seen as unknown as ResourceCollectionRef;
    const instructions = rows.map((row) => String(row.state.instructions ?? "")).join("|");
    const { userId = "", orgId = "" } = ctx.session.identity;
    await seen.create(input.tag, {
      instance: "peek",
      as: `${userId}@${orgId}`,
      instructions,
    });
    return { ok: true };
  },
});

const appFlow = defineFlow({
  kind: "app",
  resources: { ...resources, privateRoster },
  actions: {
    whoami: { inputSchema: tagInput, block: whoami },
    hand: { inputSchema: tagInput, block: handToAcmeSeat },
    peek: { inputSchema: tagInput, block: peekPrivate },
    peekBrowser: { inputSchema: tagInput, block: peekBrowser },
  },
  authentication: verified,
});

type Who = { user: string; org: string };
const ALICE: Who = { user: "alice", org: "acme" };
const BOB: Who = { user: "bob", org: "acme" };
const MALLORY: Who = { user: "mallory", org: "globex" };
const ACME_PROMPT = "ACME-CONFIDENTIAL: you work on acme's roadmap";
const ALICE_PROMPT = "ALICE-PRIVATE: my research assistant";

async function boot(stores = inMemoryStores(), options: { debug?: boolean } = {}) {
  const state = createFlowState({
    flows: { app: appFlow() },
    resolvePrincipal: verified.resolvePrincipal,
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({}),
    debugEndpointsEnabled: options.debug ?? false,
  });
  const router = (await state.getRouter()) as {
    GET: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
    POST: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
  };
  const runtime = await state.getRuntime();

  const call = async (
    method: "GET" | "POST",
    path: string[],
    who?: Who,
    body?: unknown
  ) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (who !== undefined) {
      headers["x-verified-user"] = who.user;
      headers["x-verified-org"] = who.org;
    }
    const response = await router[method](
      new Request(`http://test/api/flows/${path.join("/")}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } }
    );
    const text = await response.text();
    const isJson = response.headers.get("content-type")?.includes("json") ?? true;
    return {
      status: response.status,
      json: text.length > 0 && isJson ? JSON.parse(text) : undefined,
      text,
    };
  };

  const act = async (
    who: Who,
    sessionId: string | undefined,
    action: string,
    input: unknown,
    flowId = "app"
  ) => {
    const path =
      sessionId === undefined
        ? [flowId, "actions", action]
        : [flowId, sessionId, "actions", action];
    const posted = await call("POST", path, who, { userId: who.user, input });
    if (posted.status >= 400) {
      return { http: posted.status, error: posted.json?.error as string | undefined };
    }
    const requestId = posted.json.request?.id as string;
    for (let i = 0; i < 100; i++) {
      const seen = (await call("GET", [flowId, "requests", requestId, "status"], who)).json
        ?.status as string | undefined;
      if (seen && !["pending", "in_progress", "running", "queued"].includes(seen)) {
        return { http: posted.status, outcome: seen };
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return { http: posted.status, outcome: "vanished" };
  };

  const seenIn = async (org: string) =>
    Object.values(await runtime.stores.resourceState.getByPrefix("org", org, "seen/")).map(
      (row) => (row as { state: unknown }).state
    );

  return { state, runtime, call, act, seenIn };
}

function seat(id: string, instructions: string) {
  return seatKind({ id, config: { instructions } });
}

describe("FIX-1529 hire plane", () => {
  it("E1 a session-less action on a foreign instance is 404 before it runs", async () => {
    const h = await boot();
    h.state.register(seat("acme.eng.lead", ACME_PROMPT), { pin: { orgId: "acme" } });
    const result = await h.act(MALLORY, undefined, "whoami", { tag: "sessionless" }, "acme.eng.lead");
    expect(result).toEqual({ http: 404, error: 'Unknown flow "acme.eng.lead"' });
    expect(await h.seenIn("globex")).toEqual([]);
    expect(await h.seenIn("acme")).toEqual([]);
  });

  it("E2 bob cannot open or run alice's user-owned seat", async () => {
    const h = await boot();
    h.state.register(seat("acme.research", ALICE_PROMPT), {
      pin: { orgId: "acme", userId: "alice" },
    });
    const opened = await h.call("POST", ["acme.research", "sessions"], BOB, { userId: "bob" });
    expect(opened.status).toBe(404);
    expect(opened.json.error).toBe('Unknown flow "acme.research"');
    const ran = await h.act(BOB, undefined, "whoami", { tag: "bob" }, "acme.research");
    expect(ran.http).toBe(404);
    expect(await h.seenIn("acme")).toEqual([]);

    const alice = await h.call("POST", ["acme.research", "sessions"], ALICE, { userId: "alice" });
    expect(alice.status).toBe(201);
    const sessionId = alice.json.session?.id ?? alice.json.id;
    expect(await h.act(ALICE, sessionId, "whoami", { tag: "alice" }, "acme.research")).toEqual({
      http: 202,
      outcome: "completed",
    });
    expect(await h.seenIn("acme")).toEqual([
      { instance: "acme.research", as: "alice@acme", instructions: ALICE_PROMPT },
    ]);
  });

  it("E3 a session opened before the pin resumes as a refusal, and no block runs", async () => {
    const stores = inMemoryStores();
    const first = await boot(stores);
    const minted = seat("acme.eng.lead", ACME_PROMPT);
    first.state.register(minted);
    const opened = await first.call("POST", ["acme.eng.lead", "sessions"], MALLORY, {
      userId: "mallory",
    });
    expect(opened.status).toBe(201);
    const sessionId = opened.json.session?.id ?? opened.json.id;
    expect(first.state.unregister("acme.eng.lead")).toBe(true);

    const second = await boot(stores);
    const pinned = seat("acme.eng.lead", ACME_PROMPT);
    second.state.register(pinned, { pin: { orgId: "acme" } });
    const resumed = await second.act(
      MALLORY,
      sessionId,
      "whoami",
      { tag: "after-restart" },
      "acme.eng.lead"
    );
    expect(resumed).toEqual({ http: 404, error: 'Unknown flow "acme.eng.lead"' });

    const runtime = await second.state.getRuntime();
    await expect(
      runAction({
        flow: pinned,
        actionName: "whoami",
        input: { tag: "direct" },
        userId: "mallory",
        orgId: "globex",
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { modelResolver: createMockModelResolver({}) },
      })
    ).rejects.toBeInstanceOf(InstancePinMismatchError);
    expect(await second.seenIn("globex")).toEqual([]);
    expect(await second.seenIn("acme")).toEqual([]);
  });

  it("E4 a nested roster key stays out of the browser read and in the prefix read", async () => {
    const stores = inMemoryStores();
    const primary = await stores.resolve(["primary"]);
    await primary.resourceState!.set(
      "org",
      "acme",
      "workforce/roster/eng.lead",
      { seatId: "eng.lead", instructions: ACME_PROMPT },
      "any"
    );
    await primary.resourceState!.set(
      "org",
      "acme",
      "workforce/roster/~alice/research",
      { seatId: "research", instructions: ALICE_PROMPT },
      "any"
    );
    await primary.resourceState!.set(
      "org",
      "acme",
      "workforce/roster/alice-flat",
      { seatId: "alice-flat", instructions: "ALICE-FLAT" },
      "any"
    );
    const h = await boot(stores);
    const opened = await h.call("POST", ["app", "sessions"], BOB, { userId: "bob" });
    expect(opened.status).toBe(201);
    const sessionId = opened.json.session.id as string;
    const listed = await h.call("GET", ["sessions", sessionId, "resources", "roster"], BOB);
    expect(listed.status).toBe(200);
    const instructions = (listed.json.items ?? [])
      .map((item: { clientData?: { instructions?: string } }) => item.clientData?.instructions)
      .sort();
    expect(instructions).toEqual([ACME_PROMPT, "ALICE-FLAT"]);
    const raw = await h.runtime.stores.resourceState.getByPrefix("org", "acme", "workforce/roster/");
    expect(Object.keys(raw).sort()).toEqual([
      "workforce/roster/alice-flat",
      "workforce/roster/eng.lead",
      "workforce/roster/~alice/research",
    ]);
  });

  it("B a branded private writer lists only the caller's rows", async () => {
    const stores = inMemoryStores();
    const primary = await stores.resolve(["primary"]);
    await primary.resourceState!.set(
      "org",
      "acme",
      "workforce/roster/~alice/research",
      { instructions: ALICE_PROMPT },
      "any",
    );
    const h = await boot(stores);
    const bob = await h.call("POST", ["app", "sessions"], BOB, { userId: "bob" });
    expect(bob.status).toBe(201);
    expect(await h.act(BOB, bob.json.session.id as string, "peek", { tag: "bob-peek" })).toEqual({
      http: 202,
      outcome: "completed",
    });
    expect(await h.seenIn("acme")).toEqual([
      { instance: "peek", as: "bob@acme", instructions: "" },
    ]);

    const alice = await h.call("POST", ["app", "sessions"], ALICE, { userId: "alice" });
    expect(await h.act(ALICE, alice.json.session.id as string, "peek", { tag: "alice-peek" })).toEqual({
      http: 202,
      outcome: "completed",
    });
    const seen = await h.seenIn("acme");
    expect(seen).toContainEqual({ instance: "peek", as: "alice@acme", instructions: ALICE_PROMPT });
  });

  it("D the browser roster does not read a nested key that the prefix cache holds", async () => {
    const stores = inMemoryStores();
    const primary = await stores.resolve(["primary"]);
    await primary.resourceState!.set(
      "org",
      "acme",
      "workforce/roster/~alice/research",
      { seatId: "research", instructions: ALICE_PROMPT },
      "any",
    );
    const h = await boot(stores);
    const bob = await h.call("POST", ["app", "sessions"], BOB, { userId: "bob" });
    expect(bob.status).toBe(201);
    expect(await h.act(BOB, bob.json.session.id as string, "peekBrowser", { tag: "via-browser" })).toEqual({
      http: 202,
      outcome: "completed",
    });
    expect(await h.seenIn("acme")).toEqual([
      { instance: "peek-browser", as: "bob@acme", instructions: "undefined" },
    ]);
  });

  it("a slash in a user id does not make that user's rows a prefix of a shorter id", async () => {
    const stores = inMemoryStores();
    const primary = await stores.resolve(["primary"]);
    await primary.resourceState!.set(
      "org",
      "acme",
      "workforce/roster/~bob%2Fx/research",
      { instructions: "SLASH-USER" },
      "any",
    );
    const h = await boot(stores);
    const bob = await h.call("POST", ["app", "sessions"], BOB, { userId: "bob" });
    expect(await h.act(BOB, bob.json.session.id as string, "peek", { tag: "bob" })).toEqual({
      http: 202,
      outcome: "completed",
    });
    expect(await h.seenIn("acme")).toEqual([
      { instance: "peek", as: "bob@acme", instructions: "" },
    ]);

    const slash = await h.call("POST", ["app", "sessions"], { user: "bob/x", org: "acme" }, { userId: "bob/x" });
    expect(slash.status).toBe(201);
    expect(await h.act({ user: "bob/x", org: "acme" }, slash.json.session.id as string, "peek", { tag: "slash" })).toEqual({
      http: 202,
      outcome: "completed",
    });
    const seen = await h.seenIn("acme");
    expect(seen).toContainEqual({ instance: "peek", as: "bob/x@acme", instructions: "SLASH-USER" });
  });

  it("E6 the pin is not the address: acme.x pinned to globex admits globex and refuses acme", async () => {
    const h = await boot();
    h.state.register(seat("acme.x", "GLOBEX-PINNED"), { pin: { orgId: "globex" } });
    const acme = await h.call("POST", ["acme.x", "sessions"], ALICE, { userId: "alice" });
    expect(acme.status).toBe(404);
    expect(acme.json.error).toBe('Unknown flow "acme.x"');
    const globex = await h.call("POST", ["acme.x", "sessions"], MALLORY, { userId: "mallory" });
    expect(globex.status).toBe(201);
    const sessionId = globex.json.session.id as string;
    expect(await h.act(MALLORY, sessionId, "whoami", { tag: "g" }, "acme.x")).toEqual({
      http: 202,
      outcome: "completed",
    });
    expect(await h.seenIn("globex")).toEqual([
      { instance: "acme.x", as: "mallory@globex", instructions: "GLOBEX-PINNED" },
    ]);
  });

  it("E7 an internal dispatch into a foreign seat does not run that seat", async () => {
    const h = await boot();
    h.state.register(seat("acme.eng.lead", ACME_PROMPT), { pin: { orgId: "acme" } });
    const opened = await h.call("POST", ["app", "sessions"], MALLORY, { userId: "mallory" });
    const sessionId = opened.json.session.id as string;
    expect(await h.act(MALLORY, sessionId, "hand", { tag: "handed" })).toMatchObject({
      http: 202,
    });
    for (let i = 0; i < 40; i++) {
      if ((await h.seenIn("globex")).length > 0 || (await h.seenIn("acme")).length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(await h.seenIn("globex")).toEqual([]);
    expect(await h.seenIn("acme")).toEqual([]);

    // The same seam admits the owning org, so an empty seen-log above is the
    // refusal and not a dispatch that never starts.
    const alice = await h.call("POST", ["app", "sessions"], ALICE, { userId: "alice" });
    const aliceSession = alice.json.session.id as string;
    expect(await h.act(ALICE, aliceSession, "hand", { tag: "alice-hand" })).toEqual({
      http: 202,
      outcome: "completed",
    });
    for (let i = 0; i < 40 && (await h.seenIn("acme")).length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(await h.seenIn("acme")).toEqual([
      { instance: "acme.eng.lead", as: "alice@acme", instructions: ACME_PROMPT },
    ]);
  });

  it("E8 the catalog omits other orgs, other users, and every pin for an anonymous caller", async () => {
    const h = await boot();
    h.state.register(seat("acme.eng.lead", ACME_PROMPT), { pin: { orgId: "acme" } });
    h.state.register(seat("acme.research", ALICE_PROMPT), {
      pin: { orgId: "acme", userId: "alice" },
    });
    const ids = async (who?: Who) =>
      ((await h.call("GET", [], who)).json.flows as { id: string }[]).map((flow) => flow.id).sort();

    const mallory = await ids(MALLORY);
    expect(mallory).toContain("app");
    expect(mallory).not.toContain("acme.eng.lead");
    expect(mallory).not.toContain("acme.research");

    const bob = await ids(BOB);
    expect(bob).toContain("app");
    expect(bob).toContain("acme.eng.lead");
    expect(bob).not.toContain("acme.research");

    const alice = await ids(ALICE);
    expect(alice).toContain("acme.research");

    const anon = await h.call("GET", []);
    expect(anon.status).toBe(200);
    const anonIds = (anon.json.flows as { id: string }[]).map((flow) => flow.id);
    expect(anonIds).toContain("app");
    expect(anonIds).not.toContain("acme.eng.lead");
    expect(anonIds).not.toContain("acme.research");
  });

  it("E9 after release, a new pin refuses the old session before the block", async () => {
    const h = await boot();
    h.state.register(seat("acme.eng.lead", ACME_PROMPT), { pin: { orgId: "acme" } });
    expect(() =>
      h.state.register(seat("acme.eng.lead", "GLOBEX: rebind"), { pin: { orgId: "globex" } })
    ).toThrow();

    const opened = await h.call("POST", ["acme.eng.lead", "sessions"], ALICE, { userId: "alice" });
    expect(opened.status).toBe(201);
    const sessionId = opened.json.session.id as string;
    expect(h.state.unregister("acme.eng.lead")).toBe(true);
    h.state.register(seat("acme.eng.lead", "GLOBEX: rebind"), { pin: { orgId: "globex" } });

    const resumed = await h.act(ALICE, sessionId, "whoami", { tag: "rebound" }, "acme.eng.lead");
    expect(resumed).toEqual({ http: 404, error: 'Unknown flow "acme.eng.lead"' });
    const runtime = await h.state.getRuntime();
    const rebound = seat("acme.eng.lead", "GLOBEX: rebind");
    rebound.ownerPin = { orgId: "globex" };
    await expect(
      runAction({
        flow: rebound,
        actionName: "whoami",
        input: { tag: "rebound" },
        userId: "alice",
        orgId: "acme",
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { modelResolver: createMockModelResolver({}) },
      })
    ).rejects.toBeInstanceOf(InstancePinMismatchError);
    expect(await h.seenIn("acme")).toEqual([]);

    const globex = await h.call("POST", ["acme.eng.lead", "sessions"], MALLORY, { userId: "mallory" });
    expect(globex.status).toBe(201);
  });

  it("refuses a flow that declares workforce/roster/** even if definition was bypassed", () => {
    const registry = createFlowRegistry();
    const leak = defineFlow({
      kind: "leak",
      actions: {
        ping: {
          inputSchema: z.object({}),
          block: handler({
            name: "ping",
            inputSchema: z.object({}),
            outputSchema: z.object({ ok: z.boolean() }),
            execute: () => ({ ok: true }),
          }),
        },
      },
    })();
    (leak as { resources: unknown }).resources = {
      roster: { pattern: "workforce/roster/**", scope: "org" },
    };
    expect(() => registry.register(leak)).toThrow(/workforce\/roster\/\*\*|user-owned roster/);

    const redeclared = defineFlow({
      kind: "redeclared",
      actions: {
        ping: {
          inputSchema: z.object({}),
          block: handler({
            name: "ping-2",
            inputSchema: z.object({}),
            outputSchema: z.object({ ok: z.boolean() }),
            execute: () => ({ ok: true }),
          }),
        },
      },
    })();
    (redeclared as { resources: unknown }).resources = {
      roster: { pattern: "workforce/roster/[owner]/[seat]", scope: "org" },
    };
    expect(() => registry.register(redeclared)).toThrow(/cannot be redeclared/);

    const notes = defineFlow({
      kind: "notes",
      actions: {
        ping: {
          inputSchema: z.object({}),
          block: handler({
            name: "ping-3",
            inputSchema: z.object({}),
            outputSchema: z.object({ ok: z.boolean() }),
            execute: () => ({ ok: true }),
          }),
        },
      },
    })();
    (notes as { resources: unknown }).resources = {
      roster: { pattern: "workforce/roster/[owner]/notes", scope: "org" },
    };
    expect(() => registry.register(notes)).toThrow(/user-owned roster/);

    for (const [index, pattern] of ["workforce/[r]/[owner]/[seat]", "[a]/[b]/[c]/[d]"].entries()) {
      expect(() =>
        defineResourceCollection({ pattern, scope: "org", stateSchema: z.object({}).passthrough() })
      ).not.toThrow();
      const wide = defineFlow({
        kind: `wide-${index}`,
        resources: {
          wide: defineResourceCollection({
            pattern,
            scope: "org",
            stateSchema: z.object({}).passthrough(),
          }),
        },
        actions: {
          ping: {
            inputSchema: z.object({}),
            block: handler({
              name: "ping-wide",
              inputSchema: z.object({}),
              outputSchema: z.object({ ok: z.boolean() }),
              execute: () => ({ ok: true }),
            }),
          },
        },
      })();
      expect(() => registry.register(wide)).toThrow(/user-owned roster/);
    }
  });

  it("a shared app flow stays open to another org", async () => {
    const h = await boot();
    const opened = await h.call("POST", ["app", "sessions"], MALLORY, { userId: "mallory" });
    expect(opened.status).toBe(201);
    const sessionId = opened.json.session.id as string;
    expect(await h.act(MALLORY, sessionId, "whoami", { tag: "app" })).toEqual({
      http: 202,
      outcome: "completed",
    });
  });
});

/**
 * FIX-1535. The debug endpoints read the store without the resource handle,
 * so they get the same caller fence the handle applies: the private roster
 * writer shows a session only its own user's rows, and a topic outside a
 * collection's pattern is not read. Debug endpoints are on for these legs,
 * which is what `fsdev dev` does.
 */
describe("FIX-1535 debug listing keeps the hire plane", () => {
  async function seeded() {
    const stores = inMemoryStores();
    const primary = await stores.resolve(["primary"]);
    await primary.resourceState!.set(
      "org",
      "acme",
      "workforce/roster/~alice/research",
      { seatId: "research", instructions: ALICE_PROMPT },
      "any",
    );
    await primary.content!.set("org", "acme", "workforce/roster/~alice/research", ALICE_PROMPT);
    await primary.resourceState!.set(
      "org",
      "acme",
      "workforce/roster/eng.lead",
      { seatId: "eng.lead", instructions: ACME_PROMPT },
      "any",
    );
    const h = await boot(stores, { debug: true });
    const open = async (who: Who) => {
      const opened = await h.call("POST", ["app", "sessions"], who, { userId: who.user });
      expect(opened.status).toBe(201);
      return opened.json.session.id as string;
    };
    const debug = (who: Who, sessionId: string, ...rest: string[]) =>
      h.call("GET", ["sessions", sessionId, "debug", "resources", ...rest], who);
    return { h, open, debug };
  }

  it("bob's session does not list alice's private hire row", async () => {
    const { open, debug } = await seeded();
    const bob = await open(BOB);
    const items = await debug(BOB, bob, "privateRoster", "items");
    expect(items.status).toBe(200);
    expect(JSON.stringify(items.json)).not.toContain("ALICE-PRIVATE");
    expect(items.json.items).toEqual([]);

    const tree = await debug(BOB, bob);
    expect(tree.status).toBe(200);
    const entry = (tree.json.resources as Array<{ primaryName: string; itemCount?: number }>).find(
      (row) => row.primaryName === "privateRoster",
    );
    expect(entry?.itemCount).toBe(0);
  });

  it("bob's session does not read alice's row content by topic, through either roster", async () => {
    const { open, debug } = await seeded();
    const bob = await open(BOB);
    for (const ref of ["privateRoster", "roster"]) {
      const content = await debug(BOB, bob, ref, "~alice", "research", "content");
      expect(content.status).toBe(404);
      expect(content.text).not.toContain("ALICE-PRIVATE");
    }
  });

  it("alice's own session still lists and reads her row", async () => {
    const { open, debug } = await seeded();
    const alice = await open(ALICE);
    const items = await debug(ALICE, alice, "privateRoster", "items");
    expect(items.status).toBe(200);
    expect(items.json.items).toHaveLength(1);
    expect(items.json.items[0].state.instructions).toBe(ALICE_PROMPT);

    const tree = await debug(ALICE, alice);
    const entry = (tree.json.resources as Array<{ primaryName: string; itemCount?: number }>).find(
      (row) => row.primaryName === "privateRoster",
    );
    expect(entry?.itemCount).toBe(1);

    const content = await debug(ALICE, alice, "privateRoster", "~alice", "research", "content");
    expect(content.status).toBe(200);
    expect(content.text).toBe(ALICE_PROMPT);
  });

  it("a session in another org lists none of acme's hire rows", async () => {
    const { open, debug } = await seeded();
    const bob = await open(BOB);
    const acmeRoster = await debug(BOB, bob, "roster", "items");
    expect(acmeRoster.json.items.map((row: { topic: string }) => row.topic)).toEqual(["eng.lead"]);

    const mallory = await open(MALLORY);
    for (const ref of ["privateRoster", "roster"]) {
      const items = await debug(MALLORY, mallory, ref, "items");
      expect(items.status).toBe(200);
      expect(items.json.items).toEqual([]);
    }
  });
});
