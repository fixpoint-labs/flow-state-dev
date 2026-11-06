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
  createInMemoryStores,
  createResponseEmitter,
  runAction
} from "../src";
import { applyScopeStateDefaults } from "../src/context/scope-state-defaults";
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
  session: { client: { derived: { countSeen: ({ state }: { state: { count?: number } }) => state.count ?? "absent" } } },
  actions: { read: { inputSchema: z.object({}), block: reader } }
})();

async function runRead(stores: ReturnType<typeof createInMemoryStores>, sessionId: string) {
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
    expect(await runRead(createInMemoryStores(), "sess_block_fresh")).toEqual({
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
    await runRead(stores, "sess_block_stored");
    const session = await stores.session.get("sess_block_stored");
    await stores.session.set(
      "sess_block_stored",
      { ...session!, state: { tags: ["kept"] }, version: session!.version + 1 },
      "any"
    );

    expect(await runRead(stores, "sess_block_stored")).toMatchObject({ count: 0, tags: ["kept"], theme: "light" });
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
    const body = (await state.json()) as { clientData: { session: { countSeen: unknown } } };
    expect(body.clientData.session.countSeen).toBe(0);
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
      write: { inputSchema: z.object({ owner: z.string() }), block: ownerBlock },
      read: { inputSchema: z.object({}), block: ownerReader }
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
          actions: { a: { inputSchema: z.object({}), block: shared }, b: { inputSchema: z.object({}), block: sharedUser } }
        })()
      );
    }
    expect(registry.list().map((f) => f.id)).toEqual(["shares-1", "shares-2"]);
  });

  it("two flows that share one block's dynamic user default, each merging its own fields too, are not refused", () => {
    // The shared block defaults `visitorId`; each flow's own block types it
    // without one, so each flow's merge has two declarations of the field.
    const sharedId = handler({
      name: "shared-id",
      inputSchema: z.object({}),
      userStateSchema: z.object({
        visitorId: z.string().default(() => crypto.randomUUID()),
        prefs: z.object({ at: z.string().default(() => new Date().toISOString()) }).default({})
      }),
      execute: () => ({})
    });
    const own = (kind: string) =>
      handler({
        name: `${kind}-own`,
        inputSchema: z.object({}),
        userStateSchema: z.object({
          visitorId: z.string(),
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
          actions: { a: { inputSchema: z.object({}), block: sharedId }, b: { inputSchema: z.object({}), block: own(kind) } }
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
          a: {
            inputSchema: z.object({}),
            block: handler({ name: `${kind}-block`, inputSchema: z.object({}), userStateSchema: z.object({ theme }), execute: () => ({}) })
          }
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
