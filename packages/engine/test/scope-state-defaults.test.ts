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
import { defineCapability, defineFlow, handler } from "@flow-state-dev/core";
import type { GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createExecutionContext,
  createFlowApiRouter,
  createFlowRegistry,
  runAction
} from "../src";
import {
  createInMemoryStores
} from "../src/host";
import { createResponseEmitter } from "../src/host";
import { applyScopeStateDefaults } from "../src/context/scope-state-defaults";
import { createRequestHost } from "../src/context/create-request-host";
import { createRequestSessions } from "../src/context/request-sessions";
import { getReadonlyStateKeys } from "@flow-state-dev/core/helpers";

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
    run: handler({
        name: "noop",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (input) => input
      })
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
      run: handler({ name: "noop", inputSchema: z.number(), outputSchema: z.number(), execute: (input) => input })
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

  // An increment or push is commutative: two runs that both add must both
  // land. The first write onto a defaulted field can't use the store's delta
  // (it would start at 0 / []), so it is version-checked, and the run that
  // loses that race has to retry on the winner's record, not drop its write.
  it("two runs incrementing the same defaulted counter both count", async () => {
    const stores = createInMemoryStores();
    const a = await openDeltas(stores, "req_inc_a");
    const b = await openDeltas(stores, "req_inc_b");

    const landed = await Promise.all([a.user.incState({ count: 1 }), b.user.incState({ count: 1 })]);

    expect(landed).toEqual([true, true]);
    expect((await stores.user.get(USER_KEY))?.state).toMatchObject({ count: 12 });
  });

  it("two runs pushing onto the same defaulted array both append", async () => {
    const stores = createInMemoryStores();
    const a = await openDeltas(stores, "req_push_a");
    const b = await openDeltas(stores, "req_push_b");

    const landed = await Promise.all([a.user.pushState("tags", "a"), b.user.pushState("tags", "b")]);

    expect(landed).toEqual([true, true]);
    const tags = ((await stores.user.get(USER_KEY))?.state as { tags: string[] }).tags;
    expect([...tags].sort()).toEqual(["a", "b", "seed"]);
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
        run: handler({ name: "noop", inputSchema: z.object({}), outputSchema: z.object({}), execute: () => ({}) })
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

// ---------------------------------------------------------------------------
// Defaults a block or capability declares, with nothing restated on the flow
// ---------------------------------------------------------------------------

/** A capability that declares a session field with a default, as the skills capability does. */
const tagsCapability = defineCapability({
  name: "tags-cap",
  sessionStateSchema: z.object({ tags: z.array(z.string()).default(["new"]) })
});

/** Reads every field below; the flow itself declares none of them. */
const reader = handler({
  name: "reader",
  inputSchema: z.object({}),
  sessionStateSchema: z.object({ count: z.number().default(0) }),
  userStateSchema: z.object({ theme: z.string().default("light") }),
  orgStateSchema: z.object({ tier: z.string().default("free") }),
  uses: [tagsCapability],
  execute: (_input, ctx) => ({
    count: (ctx.session.state as { count?: number }).count,
    tags: (ctx.session.state as { tags?: string[] }).tags,
    theme: (ctx.user.state as { theme?: string }).theme,
    tier: (ctx.org?.state as { tier?: string } | undefined)?.tier
  })
});

const blockDefaultsFlow = defineFlow({
  kind: "block-defaults",
  session: { client: { expose: ["count"] } },
  actions: { read: reader }
})();

async function runReaderAction(stores: ReturnType<typeof createInMemoryStores>, sessionId: string) {
  const result = await runAction({
    orgId: ORG,
    flow: blockDefaultsFlow,
    actionName: "read",
    input: {},
    userId: USER,
    sessionId,
    stores,
    responseEmitter: createResponseEmitter({ requestId: `req_${sessionId}` }),
    runtimeConfig: {}
  });
  expect(result.error).toBeUndefined();
  return result.output as { count?: number; tags?: string[]; theme?: string; tier?: string };
}

describe("defaults a block or a capability declares", () => {
  it("read on a fresh session, user and org with no restating on the flow", async () => {
    expect(await runReaderAction(createInMemoryStores(), "sess_block_fresh")).toEqual({
      count: 0,
      tags: ["new"],
      theme: "light",
      tier: "free"
    });
  });

  it("fill a stored record that lacks the field, and keep what it holds", async () => {
    const stores = createInMemoryStores();
    // Stored before the block declared `count` and `theme`.
    await stores.user.set(
      USER_KEY,
      { id: USER_KEY, userId: USER, state: { otherFlow: 1 }, version: 0, createdAt: 0, updatedAt: 0 },
      "any"
    );
    await runReaderAction(stores, "sess_block_stored");
    const session = await stores.session.get("sess_block_stored");
    await stores.session.set(
      "sess_block_stored",
      { ...session!, state: { tags: ["kept"] }, version: session!.version + 1 },
      "any"
    );

    expect(await runReaderAction(stores, "sess_block_stored")).toMatchObject({ count: 0, tags: ["kept"], theme: "light" });
    expect((await stores.user.get(USER_KEY))?.state).toMatchObject({ otherFlow: 1 });
  });

  it("read from GET /sessions/:id/state too", async () => {
    const registry = createFlowRegistry();
    registry.register(blockDefaultsFlow);
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({ registry, stores });
    const run = await router.POST(
      new Request("http://localhost/api/flows/block-defaults/sess_block_route/actions/read", {
        method: "POST",
        body: JSON.stringify({ userId: USER, orgId: ORG, input: {} })
      }),
      { params: { path: ["block-defaults", "sess_block_route", "actions", "read"] } }
    );
    expect(run.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const state = await router.GET(new Request("http://localhost/api/flows/sessions/sess_block_route/state"), {
      params: { path: ["sessions", "sess_block_route", "state"] }
    });
    const body = (await state.json()) as { clientData: { session: { count?: unknown } } };
    expect(body.clientData.session.count).toBe(0);
  });
});

describe("a readonly session field a block declares is protected like the flow's own", () => {
  // The block owns `owner`: set when the session is born, never changed. The
  // flow restates nothing, and an action's caller supplies the value it writes.
  const ownerBlock = handler({
    name: "owner-writer",
    inputSchema: z.object({ owner: z.string() }),
    sessionStateSchema: z.object({ owner: z.string().readonly().default("alice"), note: z.string().default("") }),
    execute: async (input, ctx) => {
      await ctx.session.patchState({ owner: input.owner } as never);
      return {};
    }
  });
  // A second block that types `owner` the same way, so the merge rebuilds the field.
  const ownerReader = handler({
    name: "owner-reader",
    inputSchema: z.object({}),
    sessionStateSchema: z.object({ owner: z.string().readonly() }),
    execute: (_input, ctx) => ({ owner: (ctx.session.state as { owner?: string }).owner })
  });
  const ownerFlow = defineFlow({
    kind: "block-readonly",
    actions: {
      write: ownerBlock,
      read: ownerReader
    }
  })();

  async function run(stores: ReturnType<typeof createInMemoryStores>, actionName: "read" | "write", input: unknown) {
    return runAction({
      orgId: ORG,
      flow: ownerFlow,
      actionName,
      input,
      userId: USER,
      sessionId: "sess_block_readonly",
      stores,
      responseEmitter: createResponseEmitter({ requestId: `req_ro_${actionName}_${Math.random()}` }),
      runtimeConfig: {}
    });
  }

  it("refuses a caller's write that would change it, and the stored record keeps its value", async () => {
    const stores = createInMemoryStores();
    expect((await run(stores, "read", {})).output).toEqual({ owner: "alice" });

    const write = await run(stores, "write", { owner: "mallory" });
    expect(write.error?.message).toMatch(/readonly/i);
    expect((await stores.session.get("sess_block_readonly"))?.state).not.toMatchObject({ owner: "mallory" });
    expect((await run(stores, "read", {})).output).toEqual({ owner: "alice" });
  });

  it("is listed as readonly, so the session list exposes it", () => {
    const session = ownerFlow.scopeStateSchemas?.session;
    expect(getReadonlyStateKeys(session)).toEqual(["owner"]);
  });

  it("a flow's own readonly field stays guarded when a block's state schema is wrapped in .default({})", async () => {
    const wrapped = handler({
      name: "wrapped-writer",
      inputSchema: z.object({ owner: z.string() }),
      // A root `.default({})` on a block's state schema: meaningless for a scope
      // record, and it must not hide the flow's readonly keys.
      sessionStateSchema: z.object({ note: z.string().default("") }).default({}),
      execute: async (input, ctx) => {
        await ctx.session.patchState({ owner: input.owner } as never);
        return {};
      }
    });
    const flow = defineFlow({
      kind: "wrapped-root",
      session: { stateSchema: z.object({ owner: z.string().readonly().default("alice") }) },
      actions: { write: wrapped }
    })();
    expect(getReadonlyStateKeys(flow.scopeStateSchemas?.session)).toEqual(["owner"]);
    const stores = createInMemoryStores();
    const result = await runAction({
      orgId: ORG,
      flow,
      actionName: "write",
      input: { owner: "mallory" },
      userId: USER,
      sessionId: "sess_wrapped_root",
      stores,
      responseEmitter: createResponseEmitter({ requestId: "req_wrapped_root" }),
      runtimeConfig: {}
    });
    expect(result.error?.message).toMatch(/readonly/i);
    expect((await stores.session.get("sess_wrapped_root"))?.state).toMatchObject({ owner: "alice" });
  });

  it("is not a session-list filter: the store filters stored state, which holds no block default", async () => {
    const registry = createFlowRegistry();
    registry.register(ownerFlow);
    const stores = createInMemoryStores();
    await run(stores, "read", {});
    const router = createFlowApiRouter({ registry, stores });
    const res = await router.GET(
      new Request(`http://localhost/api/flows/sessions?userId=${USER}&orgId=${ORG}&flowKind=block-readonly&state.owner=alice`),
      { params: { path: ["sessions"] } }
    );
    // Refused by name, rather than answering an empty list for a session whose
    // owner reads "alice".
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toContain('"owner"');
  });
});

describe("reading one stored record always gives one value", () => {
  // A factory default on a field the flow doesn't declare is never stored:
  // the fill would call it on every read and give a new value each time.
  let counter = 0;
  const factoryBlock = (name: string, scope: "session" | "user" | "org", field: z.ZodTypeAny) =>
    handler({
      name,
      inputSchema: z.object({}),
      [`${scope}StateSchema`]: z.object({ id: field }),
      execute: (_input: unknown, ctx: { session: { state: unknown } }) => ({ id: (ctx.session.state as { id?: unknown }).id })
    } as never);
  const flowWith = (kind: string, block: ReturnType<typeof factoryBlock>, session?: z.AnyZodObject) =>
    defineFlow({
      kind,
      ...(session === undefined ? {} : { session: { stateSchema: session } }),
      actions: { read: { inputSchema: z.object({}), block } }
    });

  it("refuses a block-only readonly field with a factory default, by name, at defineFlow", () => {
    expect(() =>
      flowWith("counter-ro", factoryBlock("counts", "session", z.number().readonly().default(() => ++counter)))
    ).toThrow(/Flow "counter-ro": session\.state\.id has a default factory declared by block "counts"[\s\S]*declare the factory on the flow/);
  });

  it("refuses a block-only id with a factory default in every scope", () => {
    for (const scope of ["session", "user", "org"] as const) {
      expect(() => flowWith(`ids-${scope}`, factoryBlock("ids", scope, z.string().default(() => crypto.randomUUID())))).toThrow(
        new RegExp(`${scope}\\.state\\.id has a default factory declared by block "ids"`)
      );
    }
  });

  it("refuses a capability-only factory default, naming the capability", () => {
    const cap = defineCapability({ name: "stamps", sessionStateSchema: z.object({ at: z.number().default(() => Date.now()) }) });
    const block = handler({ name: "uses-stamps", inputSchema: z.object({}), uses: [cap], execute: () => ({}) });
    expect(() => defineFlow({ kind: "stamps-flow", actions: { a: { inputSchema: z.object({}), block } } })).toThrow(
      /session\.state\.at has a default factory declared by capability "stamps" \(used by block "uses-stamps"\)/
    );
  });

  it("refuses a factory default nested in a block-only object, and in a block-only array's items", () => {
    const nested = z.object({ meta: z.object({ id: z.string().default(() => "x") }).default({}) });
    expect(() => flowWith("nested-f", factoryBlock("n", "session", nested))).toThrow(/session\.state\.id\.meta\.id has a default factory declared by block "n"/);
    const items = z.array(z.object({ id: z.string().default(() => "x") }));
    expect(() => flowWith("items-f", factoryBlock("i", "session", items))).toThrow(/session\.state\.id has a default factory/);
  });

  it("accepts it once the flow declares the field, and a session reads one value however often it is read", async () => {
    const field = z.string().default(() => `id-${++counter}`);
    const flow = flowWith("ids-declared", factoryBlock("ids", "session", field), z.object({ id: field }))();
    const stores = createInMemoryStores();
    const read = async () =>
      (
        await runAction({
          orgId: ORG,
          flow,
          actionName: "read",
          input: {},
          userId: USER,
          sessionId: "sess_ids",
          stores,
          responseEmitter: createResponseEmitter({ requestId: `req_ids_${Math.random()}` }),
          runtimeConfig: {}
        })
      ).output as { id?: string };
    const first = await read();
    expect(first.id).toMatch(/^id-/);
    expect(await read()).toEqual(first);
  });

  it("accepts a static default on a block-only field: it is the same on every read", () => {
    expect(() => flowWith("static-ok", factoryBlock("s", "session", z.string().default("plan")))).not.toThrow();
  });

  it("refuses a session factory the flow declares the field without (an optional on the flow)", () => {
    const uuid = z.string().default(() => crypto.randomUUID());
    expect(() => flowWith("optional-on-flow", factoryBlock("ids", "session", uuid), z.object({ id: z.string().optional() }))).toThrow(
      /session\.state\.id has a default factory declared by block "ids"[\s\S]*would never take effect[\s\S]*declare the factory on the flow/
    );
  });

  it("refuses a session factory that differs from the one the flow declares", () => {
    const theirs = z.string().default(() => "a");
    const ours = z.string().default(() => "a");
    // A factory that isn't the flow's own would never run.
    expect(() => flowWith("other-factory", factoryBlock("ids", "session", theirs), z.object({ id: ours }))).toThrow(
      /session\.state\.id has a default factory declared by block "ids"/
    );
  });

  it("refuses any factory in user or org scope, the flow's own included: those records are stored as written", () => {
    for (const scope of ["user", "org"] as const) {
      const visitorId = z.string().default(() => crypto.randomUUID());
      const own = z.object({ visitorId });
      // The flow declares it, and a block restates the same factory.
      expect(() =>
        defineFlow({
          kind: `own-${scope}`,
          [scope]: { stateSchema: own },
          actions: {
            read: {
              inputSchema: z.object({}),
              block: handler({ name: "restates", inputSchema: z.object({}), [`${scope}StateSchema`]: own, execute: () => ({}) } as never)
            }
          }
        } as never)
      ).toThrow(new RegExp(`${scope}\\.state\\.visitorId has a default factory[\\s\\S]*static default, or set the value when you write`));
      // The flow alone declares it.
      expect(() =>
        defineFlow({
          kind: `alone-${scope}`,
          [scope]: { stateSchema: z.object({ visitorId: z.string().default(() => "x") }) },
          actions: { read: handler({ name: "n", inputSchema: z.object({}), execute: () => ({}) }) }
        } as never)
      ).toThrow(new RegExp(`${scope}\\.state\\.visitorId has a default factory declared by flow "alone-${scope}"`));
    }
  });

  it("defines and reads a flow whose state holds a generative recursive lazy schema", async () => {
    const node = (): z.ZodTypeAny => z.object({ name: z.string(), children: z.array(z.lazy(node)).default([]) });
    const reads = handler({
      name: "reads-tree",
      inputSchema: z.object({}),
      sessionStateSchema: z.object({ count: z.number().default(0) }),
      execute: (_input, ctx) => ({ tree: (ctx.session.state as { tree?: unknown }).tree })
    });
    const flow = defineFlow({
      kind: "lazy-tree",
      session: { stateSchema: z.object({ tree: node().default({ name: "root" }) }) },
      actions: { a: reads }
    })();
    const result = await runAction({
      orgId: ORG,
      flow,
      actionName: "a",
      input: {},
      userId: USER,
      sessionId: "sess_lazy",
      stores: createInMemoryStores(),
      responseEmitter: createResponseEmitter({ requestId: "req_lazy" }),
      runtimeConfig: {}
    });
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ tree: { name: "root", children: [] } });
  });

  it("merges two declarations whose roots carry different wrappers: a root wrapper means nothing to a scope record", () => {
    const flow = defineFlow({
      kind: "root-wrappers",
      session: { stateSchema: z.object({ a: z.string().default("x") }).default({}) },
      actions: {
        a: handler({
            name: "nullable-root",
            inputSchema: z.object({}),
            sessionStateSchema: z.object({ b: z.number().default(1) }).nullable(),
            execute: () => ({})
          })
      }
    })();
    expect(Object.keys((flow.scopeStateSchemas?.session as z.AnyZodObject).shape).sort()).toEqual(["a", "b"]);
  });

  it("refuses a default factory in a record's key schema a block declares, or in user state", () => {
    const keyed = z.record(z.string().default(() => "k"), z.number());
    const block = handler({ name: "keyed", inputSchema: z.object({}), sessionStateSchema: z.object({ r: keyed }), execute: () => ({}) });
    expect(() => defineFlow({ kind: "keyed-block", actions: { a: { inputSchema: z.object({}), block } } })).toThrow(
      /session\.state\.r has a default factory declared by block "keyed"/
    );
    expect(() =>
      defineFlow({
        kind: "keyed-user",
        user: { stateSchema: z.object({ r: keyed }) },
        actions: { a: handler({ name: "n", inputSchema: z.object({}), execute: () => ({}) }) }
      })
    ).toThrow(/user\.state\.r has a default factory declared by flow "keyed-user"/);
  });

  it("refuses a lazy a block declares, and a lazy in user or org state, the flow's own included", () => {
    const node = (): z.ZodTypeAny => z.object({ name: z.string(), children: z.array(z.lazy(node)).default([]) });
    const lazyBlock = handler({ name: "lazy-block", inputSchema: z.object({}), sessionStateSchema: z.object({ tree: node() }), execute: () => ({}) });
    expect(() => defineFlow({ kind: "block-lazy", actions: { a: lazyBlock } })).toThrow(
      /session\.state\.tree\.children holds a z\.lazy, declared by block "lazy-block"[\s\S]*declare it on the flow's session stateSchema, or avoid z\.lazy/
    );
    expect(() =>
      defineFlow({
        kind: "user-lazy",
        user: { stateSchema: z.object({ tree: node() }) },
        actions: { a: handler({ name: "n", inputSchema: z.object({}), execute: () => ({}) }) }
      })
    ).toThrow(/user\.state\.tree\.children holds a z\.lazy, declared by flow "user-lazy"/);
  });

  it("allows a static default in user and org scope", () => {
    expect(() =>
      defineFlow({
        kind: "static-user",
        user: { stateSchema: z.object({ theme: z.string().default("light") }) },
        actions: { read: { inputSchema: z.object({}), block: factoryBlock("t", "user", z.string().default("light")) } }
      })
    ).not.toThrow();
  });
});

describe("a read never runs a default factory: one stored record reads one value", () => {
  // Only a session's birth parse runs the flow's own factory defaults. A read
  // fills static defaults alone, so a field a factory would fill stays missing
  // on read, and two reads of one stored record always agree.
  let calls = 0;
  const id = z.string().default(() => `id-${++calls}`);
  const reader = (name: string, session?: z.AnyZodObject) =>
    handler({
      name,
      inputSchema: z.object({}),
      ...(session === undefined ? {} : { sessionStateSchema: session }),
      execute: (_input, ctx) => {
        const state = ctx.session.state as { id?: string; prefs?: { id?: string }; items?: Array<{ id?: string }> };
        return { id: state.id, prefsId: state.prefs?.id, itemIds: state.items?.map((item) => item.id) };
      }
    });
  const define = (kind: string, own: z.AnyZodObject, block = reader(`${kind}-read`)) =>
    defineFlow({ kind, session: { stateSchema: own }, actions: { a: { inputSchema: z.object({}), block } } })();
  async function readTwice(flow: ReturnType<typeof define>, stores = createInMemoryStores(), sessionId = "sess_reads") {
    const run = async () =>
      (
        await runAction({
          orgId: ORG,
          flow,
          actionName: "a",
          input: {},
          userId: USER,
          sessionId,
          stores,
          responseEmitter: createResponseEmitter({ requestId: `req_reads_${Math.random()}` }),
          runtimeConfig: {}
        })
      ).output as Record<string, unknown>;
    const first = await run();
    const before = calls;
    const second = await run();
    // The second run reads an existing record: it is not born, so no factory runs.
    expect(calls).toBe(before);
    return { first, second };
  }

  it("a session born from state its schema refuses (stored as sent) reads the factory field missing, the same each time", async () => {
    // `topic` is required and nothing binds the sessions, so birth keeps `{}` as sent.
    const flow = define("raw-birth", z.object({ topic: z.string(), id }));
    const { first, second } = await readTwice(flow);
    expect(first.id).toBeUndefined();
    expect(second).toEqual(first);
  });

  it("an old record that lacks the flow's own factory field reads it missing, the same each time", async () => {
    const flow = define("old-record", z.object({ id }));
    const stores = createInMemoryStores();
    // A record stored before the field existed.
    await runAction({
      orgId: ORG,
      flow: define("old-record-seed", z.object({})),
      actionName: "a",
      input: {},
      userId: USER,
      sessionId: "sess_old",
      stores,
      responseEmitter: createResponseEmitter({ requestId: "req_old_seed" }),
      runtimeConfig: {}
    });
    const record = await stores.session.get("sess_old");
    await stores.session.set("sess_old", { ...record!, flowKind: "old-record", flowId: "old-record" }, "any");
    const before = calls;
    const { first, second } = await readTwice(flow, stores, "sess_old");
    expect(calls).toBe(before);
    expect(first.id).toBeUndefined();
    expect(second).toEqual(first);
  });

  it("a flow-only factory under an optional parent, under an outer optional, or in an array item reads stably", async () => {
    const shapes: Array<[string, z.AnyZodObject]> = [
      ["optional-parent", z.object({ prefs: z.object({ id }).optional() })],
      ["outer-optional", z.object({ id: id.optional() })],
      ["array-item", z.object({ items: z.array(z.object({ id })).default([]) })]
    ];
    for (const [kind, own] of shapes) {
      const flow = define(kind, own);
      const { first, second } = await readTwice(flow, createInMemoryStores(), `sess_${kind}`);
      expect(second, kind).toEqual(first);
    }
  });

  it("a block restating the flow's factory is allowed only at the same path, where the flow defaults all the way down", () => {
    const refused = /has a default factory declared by block[\s\S]*would never take effect/;
    // Under another key.
    expect(() => define("other-key", z.object({ id }), reader("r1", z.object({ other: id })))).toThrow(
      /session\.state\.other has a default factory declared by block "r1"/
    );
    // Under a parent only the block declares.
    expect(() => define("block-parent", z.object({ id }), reader("r2", z.object({ wrap: z.object({ id }).default({}) })))).toThrow(
      /session\.state\.wrap\.id has a default factory declared by block "r2"/
    );
    // At the same path, but the flow's parent is optional, so birth never creates it.
    expect(() =>
      define("optional-parent-restated", z.object({ prefs: z.object({ id }).optional() }), reader("r3", z.object({ prefs: z.object({ id }).default({}) })))
    ).toThrow(refused);
    // At the same path, but the flow's own field is wrapped in an outer optional.
    expect(() => define("outer-optional-restated", z.object({ id: id.optional() }), reader("r4", z.object({ id })))).toThrow(refused);
    // The same function at the same path, defaulted all the way down: a no-op, allowed.
    expect(() =>
      define("same-path", z.object({ prefs: z.object({ id }).default({}) }), reader("r5", z.object({ prefs: z.object({ id }).default({}) })))
    ).not.toThrow();
    expect(() => define("same-leaf", z.object({ id }), reader("r6", z.object({ id })))).not.toThrow();
  });

  it("a session born with the flow's factory stores its value, and reads it back unchanged", async () => {
    const flow = define("born-stable", z.object({ id }));
    const { first, second } = await readTwice(flow, createInMemoryStores(), "sess_born");
    expect(first.id).toMatch(/^id-/);
    expect(second).toEqual(first);
  });
});

describe("a decision on stored state reads it as a run reads it, defaults filled", () => {
  // The block owns `owner`, readonly and defaulted; the flow restates nothing,
  // so a child born with no state stores `{}` and reads `{ owner: "alice" }`.
  const childBlock = handler({
    name: "child-work",
    inputSchema: z.object({}),
    sessionStateSchema: z.object({ owner: z.string().readonly().default("alice") }),
    execute: () => ({})
  });
  const childFlow = defineFlow({
    kind: "effective-child",
    actions: { noop: childBlock },
    internal: { actions: { work: childBlock } }
  })();
  const parentFlow = defineFlow({
    kind: "effective-parent",
    actions: { noop: handler({ name: "p", inputSchema: z.object({}), execute: () => ({}) }) }
  })();
  const seam = (stores: ReturnType<typeof createInMemoryStores>) =>
    createRequestHost({
      stores,
      flow: parentFlow,
      identity: { userId: USER, tenantId: undefined, orgId: ORG, sessionId: "parent", lineageId: "lin_parent" },
      dispatchOperation: async () => ({ requestId: "req_child" }),
      liveness: { staleThresholdMs: 60_000, heartbeatIntervalMs: 10_000, staleSweepIntervalMs: 30_000 },
      resolveFlow: (id) => (id === childFlow.id ? childFlow : undefined)
    });
  const send = (stores: ReturnType<typeof createInMemoryStores>, state?: Record<string, unknown>) =>
    seam(stores).seam({
      type: "internal",
      action: "work",
      flowKind: "effective-child",
      session: { key: "k", ...(state === undefined ? {} : { state }) },
      payload: {},
      from: "test"
    });

  it("adopts a child for a dispatch naming the readonly value it reads, and refuses another", async () => {
    const stores = createInMemoryStores();
    expect(await send(stores)).toMatchObject({ ok: true, adopted: false });
    expect(await send(stores, { owner: "alice" })).toMatchObject({ ok: true, adopted: true });
    expect(await send(stores, { owner: "bob" })).toMatchObject({ ok: false, refused: "key-occupied" });
  });

  it("shows another session's readonly field as it reads, default included", async () => {
    const stores = createInMemoryStores();
    const born = (await send(stores)) as { sessionId: string };
    expect((await stores.session.get(born.sessionId))?.state).toEqual({});
    const sessions = createRequestSessions({
      sessions: stores.session,
      identity: { userId: USER, tenantId: undefined, orgId: ORG },
      flow: parentFlow,
      resolveFlow: (address) => (address === childFlow.id ? childFlow : undefined)
    });
    expect((await sessions.read(born.sessionId))?.state).toEqual({ owner: "alice" });
  });
});

describe("declarations that disagree are refused before anything runs", () => {
  const leaf = (name: string, session: z.ZodTypeAny) =>
    handler({ name, inputSchema: z.object({}), sessionStateSchema: session, execute: () => ({}) });
  const flowOf = (kind: string, a: ReturnType<typeof leaf>, b: ReturnType<typeof leaf>) =>
    defineFlow({ kind, actions: { a: { inputSchema: z.object({}), block: a }, b: { inputSchema: z.object({}), block: b } } });

  it("two blocks that default one field differently: defineFlow names the field and both", () => {
    expect(() =>
      flowOf(
        "two-defaults",
        leaf("planner", z.object({ mode: z.string().default("plan") })),
        leaf("writer", z.object({ mode: z.string().default("write") }))
      )
    ).toThrow(
      // Named in the order the walk meets them; which is first decides nothing.
      /^Flow "two-defaults": session\.state\.mode is declared twice with different defaults: (block "planner" defaults it to "plan" and block "writer" to "write"|block "writer" defaults it to "write" and block "planner" to "plan")\./
    );
  });

  it("two blocks that type one field differently, at any depth", () => {
    expect(() =>
      flowOf(
        "two-types",
        leaf("a", z.object({ prefs: z.object({ size: z.string() }) })),
        leaf("b", z.object({ prefs: z.object({ size: z.number() }) }))
      )
    ).toThrow(
      /session\.state\.prefs\.size is declared twice with different types: (block "a" types it as string and block "b" as number|block "b" types it as number and block "a" as string)/
    );
    expect(() =>
      flowOf("nullable", leaf("a", z.object({ x: z.string() })), leaf("b", z.object({ x: z.string().nullable() })))
    ).toThrow(/session\.state\.x is declared twice with different types/);
  });

  it("the flow's own declaration and a block's are held to the same rule", () => {
    expect(() =>
      defineFlow({
        kind: "flow-and-block",
        session: { stateSchema: z.object({ mode: z.enum(["a", "b"]) }) },
        actions: { a: { inputSchema: z.object({}), block: leaf("loose", z.object({ mode: z.string() })) } }
      })
    ).toThrow(/flow "flow-and-block" types it as enum\["a","b"\] and block "loose" as string/);
  });

  it("two capabilities on one block that disagree name the capabilities", () => {
    const capA = defineCapability({ name: "cap-a", sessionStateSchema: z.object({ n: z.number().default(1) }) });
    const capB = defineCapability({ name: "cap-b", sessionStateSchema: z.object({ n: z.number().default(2) }) });
    const block = handler({ name: "both", inputSchema: z.object({}), uses: [capA, capB], execute: () => ({}) });
    expect(() => defineFlow({ kind: "two-caps", actions: { a: { inputSchema: z.object({}), block } } })).toThrow(
      'capability "cap-a" (used by block "both") defaults it to 1 and capability "cap-b" (used by block "both") to 2'
    );
  });

  it("agree quietly: identical declarations, new fields, and a default on one side only", async () => {
    const merged = flowOf(
      "agreeing",
      leaf("a", z.object({ mode: z.string().default("x"), only: z.number().default(1) })),
      leaf("b", z.object({ mode: z.string().default("x"), prefs: z.object({ size: z.number().default(2) }).default({}) }))
    );
    const ctx = await createExecutionContext({
      flow: defineFlow({
        kind: "agreeing-plus",
        session: { stateSchema: z.object({ mode: z.string() }) },
        actions: merged.actions
      })(),
      actionName: "a",
      requestId: "req_agree",
      sessionId: "sess_agree",
      userId: USER,
      orgId: ORG,
      stores: createInMemoryStores(),
      response: createResponseEmitter({ requestId: "req_agree" }),
      modelResolver: stubResolver((modelId) => ({ modelId, async generate() { return { text: "ok" }; } }))
    });
    expect(ctx.session.state).toEqual({ mode: "x", only: 1, prefs: { size: 2 } });
  });

  it("the same blocks in two flows on one server are not refused", () => {
    const shared = leaf("shared", z.object({ mode: z.string().default("x") }));
    const sharedUser = handler({
      name: "shared-user",
      inputSchema: z.object({}),
      userStateSchema: z.object({ theme: z.string().default("light") }),
      execute: () => ({})
    });
    const registry = createFlowRegistry();
    for (const kind of ["shares-1", "shares-2"]) {
      registry.register(
        defineFlow({
          kind,
          actions: { a: { inputSchema: z.object({}), block: shared }, b: sharedUser }
        })()
      );
    }
    expect(registry.list().map((f) => f.id)).toEqual(["shares-1", "shares-2"]);
  });

  it("two flows that share one block's constrained user field, each merging it again, are not refused", () => {
    // A constrained field compares by identity, so it agrees across flows only
    // while each flow's merge keeps the shared schema object itself. Each flow's
    // own block types the field again, without the default, so each flow's
    // merge has two declarations of it; `prefs` is a merged object in each.
    const code = z.string().min(2);
    const sharedCode = handler({
      name: "shared-code",
      inputSchema: z.object({}),
      userStateSchema: z.object({ code: code.default("ab"), prefs: z.object({ at: code.default("cd") }).default({}) }),
      execute: () => ({})
    });
    const own = (kind: string) =>
      handler({
        name: `${kind}-own`,
        inputSchema: z.object({}),
        userStateSchema: z.object({
          code,
          [`${kind}Count`]: z.number().default(0),
          prefs: z.object({ size: z.number().default(1) })
        }),
        execute: () => ({})
      });
    const registry = createFlowRegistry();
    for (const kind of ["visits-1", "visits-2"]) {
      registry.register(
        defineFlow({
          kind,
          actions: { a: sharedCode, b: { inputSchema: z.object({}), block: own(kind) } }
        })()
      );
    }
    expect(registry.list().map((f) => f.id)).toEqual(["visits-1", "visits-2"]);
  });

  it("two flows on one server that type a shared user field differently: the second is refused, both named", () => {
    const userFlow = (kind: string, theme: z.ZodTypeAny) =>
      defineFlow({
        kind,
        actions: {
          a: handler({ name: `${kind}-block`, inputSchema: z.object({}), userStateSchema: z.object({ theme }), execute: () => ({}) })
        }
      })();
    const registry = createFlowRegistry();
    registry.register(userFlow("themes-string", z.string()));
    expect(() => registry.register(userFlow("themes-number", z.number()))).toThrow(
      /Flows "themes-string" and "themes-number" declare incompatible user\.stateSchema/
    );

    const defaults = createFlowRegistry();
    defaults.register(userFlow("dark-default", z.string().default("dark")));
    expect(() => defaults.register(userFlow("light-default", z.string().default("light")))).toThrow(
      /incompatible user\.stateSchema\.theme schemas \(incompatible-default: flow "dark-default" defaults it to "dark" and flow "light-default" to "light"\)/
    );
  });

  it("session fields are not compared across flows: each session belongs to one flow", () => {
    const registry = createFlowRegistry();
    registry.register(flowOf("sess-a", leaf("a1", z.object({ mode: z.string() })), leaf("a2", z.object({})))());
    expect(() =>
      registry.register(flowOf("sess-b", leaf("b1", z.object({ mode: z.number() })), leaf("b2", z.object({})))())
    ).not.toThrow();
  });
});

describe("applyScopeStateDefaults", () => {
  it("leaves a field that declares a factory exactly as stored, refinement or not: no parse, no static fill inside", () => {
    let calls = 0;
    const schema = z.object({
      prefs: z
        .object({ size: z.number(), id: z.string().default(() => `id-${++calls}`), theme: z.string().default("plain") })
        .refine((value) => value.size > 0),
      other: z.number().default(1)
    });
    expect(applyScopeStateDefaults(schema, { prefs: { size: -1 } })).toEqual({ prefs: { size: -1 }, other: 1 });
    // The cost: a static default nested in a factory-bearing field no longer fills.
    expect(applyScopeStateDefaults(schema, { prefs: { size: 2 } })).toEqual({ prefs: { size: 2 }, other: 1 });
    expect(calls).toBe(0);
  });

  it("leaves a field whose factory default feeds a transform as stored, without throwing", () => {
    const schema = z.object({ s: z.string().default(() => "abc").transform((value) => value.toUpperCase()) });
    expect(applyScopeStateDefaults(schema, {})).toEqual({});
    expect(applyScopeStateDefaults(schema, { s: "kept" })).toEqual({ s: "kept" });
  });

  it("still fills the static defaults of a field that declares no factory and no lazy", () => {
    const schema = z.object({ prefs: z.object({ theme: z.string().default("plain"), size: z.number() }) });
    expect(applyScopeStateDefaults(schema, { prefs: { size: 2 } })).toEqual({ prefs: { size: 2, theme: "plain" } });
    expect(applyScopeStateDefaults(schema, { prefs: { size: "bad" } })).toEqual({ prefs: { size: "bad" } });
  });

  it("treats a refinement that throws on stored junk as not fitting", () => {
    const schema = z.object({
      p: z.object({ name: z.string().optional(), theme: z.string().default("plain") }).refine((v) => v.name!.length > 0)
    });
    expect(applyScopeStateDefaults(schema, { p: {} })).toEqual({ p: {} });
  });

  it("leaves a field holding a lazy as stored, never parsing it: a generative recursive tree reads without expanding", () => {
    // A getter that builds a fresh schema on every call.
    const node = (): z.ZodTypeAny => z.object({ name: z.string(), children: z.array(z.lazy(node)).default([]) });
    const schema = z.object({ tree: node().default({ name: "root" }), other: z.number().default(1) });
    // `tree` holds a lazy, so it can't be shown factory-free: left as stored; `other` still fills.
    expect(applyScopeStateDefaults(schema, {})).toEqual({ other: 1 });
    expect(applyScopeStateDefaults(schema, { tree: { name: "a", children: [{ name: "b" }] } })).toEqual({
      tree: { name: "a", children: [{ name: "b" }] },
      other: 1
    });
  });

  it("leaves a record whose key schema declares a factory as stored", () => {
    let calls = 0;
    const key = z.string().default(() => `k-${++calls}`);
    const schema = z.object({ r: z.record(key, z.object({ v: z.number().default(1) })) });
    // Without the key factory seen, the value's static default would fill.
    expect(applyScopeStateDefaults(schema, { r: { a: {} } })).toEqual({ r: { a: {} } });
    const map = z.object({ m: z.map(key, z.number()) });
    expect(applyScopeStateDefaults(map, {})).toEqual({});
    expect(calls).toBe(0);
  });

  it("never runs a factory inside a lazy on a read", () => {
    let calls = 0;
    const schema = z.object({ t: z.lazy(() => z.object({ id: z.string().default(() => `id-${++calls}`) })) });
    expect(applyScopeStateDefaults(schema, { t: {} })).toEqual({ t: {} });
    expect(calls).toBe(0);
  });

  it("leaves a value as stored when the factory-free check's refinement throws on the missing factory field", () => {
    const schema = z.object({
      p: z
        .object({ id: z.string().default(() => "x1"), theme: z.string().default("plain") })
        .refine((value) => value.id.startsWith("x"))
    });
    expect(applyScopeStateDefaults(schema, { p: {} })).toEqual({ p: {} });
  });

  it("leaves a field that fails its schema as stored, though the field declares a factory, and runs no factory", () => {
    let calls = 0;
    const schema = z.object({
      prefs: z.object({
        mode: z.enum(["light", "dark"]),
        id: z.string().default(() => `id-${++calls}`),
        theme: z.string().default("plain")
      })
    });
    expect(applyScopeStateDefaults(schema, { prefs: { mode: "bad" } })).toEqual({ prefs: { mode: "bad" } });
    // A field that declares a factory is left as stored, valid or not.
    expect(applyScopeStateDefaults(schema, { prefs: { mode: "dark" } })).toEqual({ prefs: { mode: "dark" } });
    expect(calls).toBe(0);
  });

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

  it("fills a nested object from its own field schemas, not a transform's swapped output", () => {
    const row = z.object({ flag: z.boolean().default(false) });
    const schema = z.object({
      obj: z.object({ a: row, b: row }).transform(({ a, b }) => ({ a: b, b: a }))
    });
    // Sourced from the swapped parse, "b" would take "a"'s stored `true`.
    expect(applyScopeStateDefaults(schema, { obj: { a: { flag: true }, b: {} } })).toEqual({
      obj: { a: { flag: true }, b: { flag: false } }
    });
  });

  it("fills array elements reached through a record's value schema", () => {
    const schema = z.object({ rows: z.record(z.array(z.object({ flag: z.boolean().default(false) }))) });
    expect(applyScopeStateDefaults(schema, { rows: { x: [{}, { flag: true }] } })).toEqual({
      rows: { x: [{ flag: false }, { flag: true }] }
    });
  });

  it("a transform's default fills in its declared value, never the transformed one", () => {
    const schema = z.object({
      before: z.string().transform((s) => s.toUpperCase()).default("anon"),
      after: z.string().default("anon").transform((s) => s.toUpperCase())
    });
    expect(applyScopeStateDefaults(schema, {})).toEqual({ before: "anon", after: "anon" });
  });

  it("leaves a union value as stored, even where a variant declares a default", () => {
    // Bounded on purpose: only objects, arrays, records and their wrappers are
    // walked. A union is never given a value, so it can never be given a wrong one.
    const schema = z.object({
      pick: z.union([z.object({ kind: z.literal("a"), flag: z.boolean().default(false) }), z.string()])
    });
    const stored = { pick: { kind: "a" } };
    expect(applyScopeStateDefaults(schema, stored)).toBe(stored);
  });
});
