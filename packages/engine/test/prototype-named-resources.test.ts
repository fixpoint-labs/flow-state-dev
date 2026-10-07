/**
 * Resources whose accessor (and so storage key) collides with an
 * `Object.prototype` member — `__proto__`, `toString`, `constructor`.
 *
 * Accessor names are author-supplied and unrestricted, and the runtime keys
 * its per-scope caches by them: the normalized state and content maps, the
 * version map every write is conditional on, the load seeds and the
 * flow-level config subsets. On a plain `{}` each of those misbehaves:
 *
 * - a `__proto__` write goes through the inherited setter, so the entry never
 *   becomes an own key (or replaces the map's prototype outright);
 * - `key in map` is true for every inherited name, so a resource named
 *   `toString` looks "already loaded" and its default is never seeded;
 * - `map[key] ?? fallback` returns the inherited function, so the version a
 *   write is conditional on becomes `Object.prototype.toString` instead of `0`.
 *
 * Every case drives the real path — `createExecutionContext` over
 * `createInMemoryStores` — and the helpers that build those maps directly.
 */
import {
  DEFAULT_ORG_ID,
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExecutionContext, createInMemoryStores, type StoreRegistry } from "../src";
import {
  filterFlowLevelEager,
  loadDeclaredResourceState,
  loadDeclaredScopeContent,
  normalizeScopeResourceContent,
  normalizeScopeResources
} from "../src/context/resource-registry";
import { toBareStates, toVersions } from "../src/stores/resource-state-views";

const PROTOTYPE_NAMES = ["__proto__", "toString", "constructor"] as const;
const INHERITED_NAMES = ["__proto__", "toString", "constructor", "valueOf", "hasOwnProperty"];

function prefsResource(scope: "session" | "user") {
  return defineResource({
    scope,
    stateSchema: z.object({ theme: z.string() }),
    default: { theme: "dark" },
    content: "seeded body"
  });
}

/** One flow declaring a resource under each prototype-colliding accessor. */
function makeFlow(scope: "session" | "user") {
  // A computed `["__proto__"]` key defines an own property; `{ __proto__: x }`
  // or `obj["__proto__"] = x` would set the prototype instead.
  const resources = {
    ["__proto__"]: prefsResource(scope),
    toString: prefsResource(scope),
    constructor: prefsResource(scope)
  };
  return defineFlow({
    kind: `fix1254-${scope}`,
    actions: {
      run: {
        inputSchema: z.string(),
        block: handler({ name: "noop", execute: () => "ok" })
      }
    },
    resources: resources as never
  })();
}

type Handle = {
  path: string;
  state: { theme: string };
  patchState(u: { theme: string }): Promise<void>;
  readContent(): Promise<string | null>;
};

async function makeCtx(stores: StoreRegistry, scope: "session" | "user", requestId: string) {
  const ctx = await createExecutionContext({
    orgId: DEFAULT_ORG_ID,
    flow: makeFlow(scope),
    actionName: "run",
    requestId,
    sessionId: "sess_1",
    userId: "user_1",
    stores
  });
  return ctx.resources as unknown as { get(name: string): Handle; list(): Handle[] };
}

describe.each(["session", "user"] as const)(
  "resources named after Object.prototype members (%s scope)",
  (scope) => {
    const scopeId = scope === "session" ? "sess_1" : `user_1:~org:${DEFAULT_ORG_ID}`;

    it("declares every accessor as its own resource", () => {
      const declared = makeFlow(scope).resources ?? {};
      for (const name of PROTOTYPE_NAMES) expect(Object.hasOwn(declared, name)).toBe(true);
    });

    it("seeds each resource's default state and content", async () => {
      const bag = await makeCtx(createInMemoryStores(), scope, "req_seed");
      expect(bag.list()).toHaveLength(PROTOTYPE_NAMES.length);
      for (const name of PROTOTYPE_NAMES) {
        const ref = bag.get(name);
        expect(ref.path).toBe(name);
        // A skipped seed leaves `state` reading whatever the cache inherited.
        expect(ref.state).toEqual({ theme: "dark" });
        expect(await ref.readContent()).toBe("seeded body");
      }
    });

    it("writes each resource under its own storage key, conditional on version 0", async () => {
      const stores = createInMemoryStores();
      const bag = await makeCtx(stores, scope, "req_write");
      for (const name of PROTOTYPE_NAMES) {
        // An inherited version here is a function, not a number, and the
        // conditional write refuses it.
        await bag.get(name).patchState({ theme: `light-${name}` });
      }
      for (const name of PROTOTYPE_NAMES) {
        const row = await stores.resourceState.get(scope, scopeId, name);
        expect(row?.state).toEqual({ theme: `light-${name}` });
        expect(row?.version).toBe(1);
      }
    });

    it("reads persisted state back in a later request and writes on top of it", async () => {
      const stores = createInMemoryStores();
      const first = await makeCtx(stores, scope, "req_1");
      for (const name of PROTOTYPE_NAMES) await first.get(name).patchState({ theme: `v1-${name}` });

      const second = await makeCtx(stores, scope, "req_2");
      for (const name of PROTOTYPE_NAMES) {
        const ref = second.get(name);
        expect(ref.state).toEqual({ theme: `v1-${name}` });
        // The loaded version must be the one this write is conditional on;
        // a lost version reads as 0 and the write conflicts with the row.
        await ref.patchState({ theme: `v2-${name}` });
        const row = await stores.resourceState.get(scope, scopeId, name);
        expect(row?.state).toEqual({ theme: `v2-${name}` });
        expect(row?.version).toBe(2);
      }
    });
  }
);

describe("a lazy collection instance keyed by an Object.prototype member", () => {
  // A single-parameter pattern makes the instance key the storage key itself,
  // so the on-demand loader's "already cached?" check sees the bare name.
  const notes = defineResourceCollection({
    scope: "session",
    pattern: "[name]",
    prefetchMode: "lazy",
    stateSchema: z.object({ n: z.number() })
  });
  const flow = defineFlow({
    kind: "fix1254-lazy",
    resources: { notes },
    actions: {
      run: { inputSchema: z.string(), block: handler({ name: "noop", execute: () => "ok" }) }
    }
  })();
  type Lazy = { get(k: Record<string, string>): Promise<{ state: { n: number } }> };
  const ctxFor = async (stores: StoreRegistry) =>
    (
      await createExecutionContext({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        requestId: "req_lazy",
        sessionId: "sess_1",
        userId: "user_1",
        stores
      })
    ).resources as unknown as { notes: Lazy };

  it("fetches each key from the store after an earlier on-demand load", async () => {
    const stores = createInMemoryStores();
    for (const [i, key] of ["plain", "toString", "constructor"].entries()) {
      await stores.resourceState.set("session", "sess_1", key, { n: i }, "any");
    }
    const lazy = (await ctxFor(stores)).notes;
    // The first load rebuilds the cache; an inherited member on the rebuilt
    // map then reads as "already cached" and the store is never asked.
    expect((await lazy.get({ name: "plain" })).state).toEqual({ n: 0 });
    expect((await lazy.get({ name: "toString" })).state).toEqual({ n: 1 });
    expect((await lazy.get({ name: "constructor" })).state).toEqual({ n: 2 });
  });
});

describe("accessor-keyed runtime maps carry no inherited members", () => {
  const stores = createInMemoryStores();

  it("returns undefined, not a builtin, for an undeclared key", async () => {
    const maps: Record<string, Record<string, unknown>> = {
      normalizeScopeResources: normalizeScopeResources({}, undefined),
      normalizeScopeResourceContent: normalizeScopeResourceContent({}, undefined),
      filterFlowLevelEager: filterFlowLevelEager({ a: prefsResource("session") as never }, new Set(["a"])),
      toVersions: toVersions({}),
      toBareStates: toBareStates({}),
      loadDeclaredResourceState: await loadDeclaredResourceState(stores.resourceState, "session", "s", {
        a: prefsResource("session") as never
      }),
      loadDeclaredScopeContent: await loadDeclaredScopeContent(stores.content, "session", "s", {
        a: prefsResource("session") as never
      })
    };
    for (const [label, map] of Object.entries(maps)) {
      for (const name of INHERITED_NAMES) {
        expect({ label, name, value: map[name], has: name in map }).toEqual({
          label,
          name,
          value: undefined,
          has: false
        });
      }
    }
  });

  it("keeps a __proto__ accessor as an own entry of the flow-level subset", () => {
    const configs = Object.create(null) as Record<string, never>;
    configs["__proto__"] = prefsResource("session") as never;
    const out = filterFlowLevelEager(configs, new Set(["__proto__"]));
    expect(Object.keys(out)).toEqual(["__proto__"]);
  });
});
