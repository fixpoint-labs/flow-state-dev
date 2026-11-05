/**
 * Scope state reads with its schema's defaults.
 *
 * `ctx.session/user/org.state` is typed `z.infer` of the flow's scope
 * `stateSchema`, which says a defaulted field is always present. These tests
 * hold the runtime to that promise on every way a scope's state is read during
 * a run: a fresh record, a stored record older than the schema, and the
 * re-read after a concurrent write. They also hold the other half: a user or
 * org record is one blob shared by every flow, so filling defaults must never
 * drop what another flow stored there.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createExecutionContext,
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  createResponseEmitter
} from "../src";
import { applyScopeStateDefaults } from "../src/context/scope-state-defaults";

const ORG = "org_defaults";
const USER = "user_defaults";
const USER_KEY = `${USER}:~org:${ORG}`;

function stubResolver(resolve: (modelId: string) => GeneratorModel): ModelResolver {
  return Object.assign(resolve, { resolveId: (modelId: string) => modelId });
}

const flow = defineFlow({
  kind: "scope-defaults",
  session: {
    stateSchema: z.object({
      mode: z.string().default("chat"),
      // A field a session may be created without on purpose and fill later.
      topic: z.string(),
      features: z.object({ search: z.boolean().default(false) }).default({})
    })
  },
  user: {
    stateSchema: z.object({
      count: z.number().default(0),
      prefs: z.object({ theme: z.string().default("light") }).default({})
    })
  },
  org: { stateSchema: z.object({ tier: z.string().default("free") }) },
  actions: {
    run: {
      inputSchema: z.number(),
      block: handler({
        name: "noop",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (input) => input
      })
    }
  }
})();

type UserState = { count: number; prefs: { theme: string; lang?: string } };
type SessionState = { mode: string; topic?: string; features: { search: boolean } };

/** This flow's scope state, typed as its schema promises (the context's own types are untyped JSON). */
const userOf = (ctx: { user: { state: unknown } }) => ctx.user.state as UserState;
const sessionOf = (ctx: { session: { state: unknown } }) => ctx.session.state as SessionState;

async function open(stores: ReturnType<typeof createInMemoryStores>, requestId: string) {
  return createExecutionContext({
    flow,
    actionName: "run",
    requestId,
    sessionId: "sess_defaults",
    userId: USER,
    orgId: ORG,
    stores,
    response: createResponseEmitter({ requestId }),
    modelResolver: stubResolver((modelId) => ({
      modelId,
      async generate() {
        return { text: "ok" };
      }
    }))
  });
}

describe("scope state defaults on load", () => {
  it("a fresh user, session and org read every defaulted field with no fallback", async () => {
    const ctx = await open(createInMemoryStores(), "req_fresh");

    expect(userOf(ctx).count).toBe(0);
    expect(userOf(ctx).prefs.theme).toBe("light");
    expect(sessionOf(ctx).mode).toBe("chat");
    // Nested inside an object default, as kitchen-sink's `features.search` reads it.
    expect(sessionOf(ctx).features.search).toBe(false);
    expect(ctx.org?.state.tier).toBe("free");
  });

  it("keeps another flow's keys on the shared user record through a load and a save", async () => {
    const stores = createInMemoryStores();
    // A record another flow wrote: a key this flow doesn't declare, and a key
    // inside `prefs` that another flow's compatible schema extends it with.
    await stores.user.set(
      USER_KEY,
      {
        id: USER_KEY,
        userId: USER,
        state: { otherFlow: { seen: 3 }, prefs: { lang: "fr" } },
        version: 0,
        createdAt: 0,
        updatedAt: 0
      },
      "any"
    );

    const ctx = await open(stores, "req_shared");
    expect(ctx.user.state).toEqual({ otherFlow: { seen: 3 }, prefs: { lang: "fr", theme: "light" }, count: 0 });

    // A two-field patch writes the whole record back.
    await ctx.user.patchState({ count: 1, prefs: { ...userOf(ctx).prefs, theme: "dark" } });

    const stored = await stores.user.get(USER_KEY);
    expect(stored?.state).toEqual({ otherFlow: { seen: 3 }, prefs: { lang: "fr", theme: "dark" }, count: 1 });
  });

  it("keeps reading defaults after a one-field write adopts the stored record", async () => {
    const stores = createInMemoryStores();
    const ctx = await open(stores, "req_delta");

    // A literal one-field patch is a delta write; the scope then holds the
    // record the store returns, which carries only what was ever written.
    await ctx.user.patchState({ count: 5 });

    expect(userOf(ctx).count).toBe(5);
    expect(userOf(ctx).prefs.theme).toBe("light");
  });

  it("a field that fails its schema does not stop its siblings getting their defaults", async () => {
    const ctx = await open(createInMemoryStores(), "req_half");
    // `topic` is required with no default and the session was created without it.
    expect(sessionOf(ctx).topic).toBeUndefined();
    expect(sessionOf(ctx).mode).toBe("chat");
  });

  it("the re-read after a concurrent write reads defaults too", async () => {
    const stores = createInMemoryStores();
    const ctx = await open(stores, "req_cas");

    // Another writer replaces the record with one that lacks `count`, so this
    // run's next read-modify-write conflicts and re-reads the stored state.
    const held = await stores.user.get(USER_KEY);
    await stores.user.set(
      USER_KEY,
      { ...held!, state: { otherFlow: true }, version: held!.version + 1 },
      "any"
    );

    await ctx.user.patchState("count", (count) => (count as number) + 1);

    const stored = await stores.user.get(USER_KEY);
    expect(stored?.state).toMatchObject({ otherFlow: true, count: 1 });
  });
});

describe("native delta writes start from the defaulted value", () => {
  // The in-memory store advertises `incField` / `pushToArray`, which start a
  // field the record lacks at 0 / []. The scope reads the field's default, so
  // a delta write must build on that, not on the store's empty start.
  const deltas = defineFlow({
    kind: "scope-defaults-deltas",
    user: {
      stateSchema: z.object({
        count: z.number().default(10),
        tags: z.array(z.string()).default(["seed"])
      })
    },
    actions: {
      run: {
        inputSchema: z.number(),
        block: handler({ name: "noop", inputSchema: z.number(), outputSchema: z.number(), execute: (input) => input })
      }
    }
  })();

  async function openDeltas(stores: ReturnType<typeof createInMemoryStores>, requestId: string) {
    return createExecutionContext({
      flow: deltas,
      actionName: "run",
      requestId,
      sessionId: "sess_deltas",
      userId: USER,
      orgId: ORG,
      stores,
      response: createResponseEmitter({ requestId }),
      modelResolver: stubResolver((modelId) => ({
        modelId,
        async generate() {
          return { text: "ok" };
        }
      }))
    });
  }

  it("an increment on a defaulted counter adds to its default", async () => {
    const stores = createInMemoryStores();
    const ctx = await openDeltas(stores, "req_inc");

    await ctx.user.incState({ count: 1 });

    expect((ctx.user.state as { count: number }).count).toBe(11);
    expect((await stores.user.get(USER_KEY))?.state).toMatchObject({ count: 11 });
    // Once the field is stored, later increments take the delta path and still add up.
    await ctx.user.incState({ count: 1 });
    expect((await stores.user.get(USER_KEY))?.state).toMatchObject({ count: 12 });
  });

  it("a push onto a defaulted array appends to its default", async () => {
    const stores = createInMemoryStores();
    const ctx = await openDeltas(stores, "req_push");

    await ctx.user.pushState("tags", "new");

    expect((ctx.user.state as { tags: string[] }).tags).toEqual(["seed", "new"]);
    expect((await stores.user.get(USER_KEY))?.state).toMatchObject({ tags: ["seed", "new"] });
  });
});

describe("the /state projection reads defaults too", () => {
  it("exposes a defaulted field the stored record never held", async () => {
    const projected = defineFlow({
      kind: "scope-defaults-projected",
      user: {
        stateSchema: z.object({ count: z.number().default(0) }),
        client: { expose: ["count"] }
      },
      actions: {
        run: {
          inputSchema: z.object({}),
          block: handler({ name: "noop", inputSchema: z.object({}), outputSchema: z.object({}), execute: () => ({}) })
        }
      }
    })();
    const registry = createFlowRegistry();
    registry.register(projected);
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({ registry, stores });

    const run = await router.POST(
      new Request("http://localhost/api/flows/scope-defaults-projected/sess_proj/actions/run", {
        method: "POST",
        body: JSON.stringify({ userId: USER, orgId: ORG, input: {} })
      }),
      { params: { path: ["scope-defaults-projected", "sess_proj", "actions", "run"] } }
    );
    expect(run.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Nothing writes `count`, so the stored record never holds a value for it.

    const state = await router.GET(new Request("http://localhost/api/flows/sessions/sess_proj/state"), {
      params: { path: ["sessions", "sess_proj", "state"] }
    });
    expect(((await state.json()) as { clientData: { user: { count: number } } }).clientData.user.count).toBe(0);
  });
});

describe("applyScopeStateDefaults", () => {
  it("fills only what is missing and keeps present values as stored", () => {
    const schema = z.object({
      name: z.string().transform((s) => s.toUpperCase()).default("anon"),
      tags: z.array(z.object({ on: z.boolean().default(true) })).default([])
    });
    const stored = { name: "ada", tags: [{}, { on: false }] };
    // The transform never rewrites a stored value; array elements get theirs.
    expect(applyScopeStateDefaults(schema, stored)).toEqual({ name: "ada", tags: [{ on: true }, { on: false }] });
  });

  it("fills each array element from its own schema, not a transform's reordered output", () => {
    const schema = z.object({
      rows: z
        .array(z.object({ id: z.string(), flag: z.boolean().default(false) }))
        .transform((rows) => [...rows].reverse())
        .default([])
    });
    const stored = { rows: [{ id: "a", flag: true }, { id: "b" }] };
    // Lined up by position against the reversed parse, "b" would take "a"'s stored `true`.
    expect(applyScopeStateDefaults(schema, stored)).toEqual({
      rows: [
        { id: "a", flag: true },
        { id: "b", flag: false }
      ]
    });
  });

  it("returns the stored object itself when nothing was missing", () => {
    const schema = z.object({ a: z.number().default(1) });
    const stored = { a: 2, extra: "x" };
    expect(applyScopeStateDefaults(schema, stored)).toBe(stored);
  });

  it("reads through a root wrapper and treats an absent state as empty", () => {
    const schema = z.object({ a: z.number().default(1) }).default({});
    expect(applyScopeStateDefaults(schema, undefined)).toEqual({ a: 1 });
    expect(applyScopeStateDefaults(undefined, undefined)).toEqual({});
  });
});
