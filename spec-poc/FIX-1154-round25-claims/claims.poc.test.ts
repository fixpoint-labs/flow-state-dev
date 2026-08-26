/**
 * FIX-1154 — claim checks for rounds 25, 26 and 28. Throwaway; never merges.
 *
 * WHY A THIRD FILE
 * Each round below corrected a factual claim in the write-up that had been
 * argued from a code read on one side and a review comment on the other, and
 * this document's own §10 rule is that a claim about runtime behaviour is
 * settled by running it. They live here rather than in
 * `FIX-1154-resource-mutation-verbs/` so that suite's "twenty-four rows" stays
 * an accurate count — adding rows to it would have made §10's own figure stale,
 * which is the exact defect round 24 recorded.
 *
 * WHAT EACH GROUP SETTLES
 *  1. §2's fold headline said "a resource write is ALWAYS version-checked".
 *     Map row 10 simultaneously recorded `create(..., { replace: true })` as a
 *     deliberate unconditional overwrite. Both cannot be true.
 *  2. §7c's table said an array's custom own property is kept by clone-first
 *     adapters and dropped by stringify-first ones — an adapter divergence. If
 *     Zod strips the property first, no adapter ever sees it.
 *  3. §11 said `deleteStateRecord` persists at `expectedVersion: "any"`. That is
 *     conditional on the adapter advertising the native verb.
 *  4. §9/§11 scoped the silent first-touch no-op to a schema with no valid
 *     complete default (round 26: false — the condition is the seed), and then
 *     to whether a row exists (round 28: also false). Group 4 drives the single
 *     handle's composition; group 4b drives the REAL registry and settles what
 *     the axis is, what the collection handle does instead, and how far it
 *     reaches.
 *  5. D6's replay predicate required `retryableErrors` unset or empty. A
 *     non-empty allowlist containing a matching class replays it too.
 *
 * These drive real modules — `runResourceCAS`, the repo's Zod,
 * `createScopePersist` over the real memory and filesystem scope stores, and
 * (group 4b) `createExecutionContext` with the shipped collection handle. No
 * mocked stores anywhere.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { runResourceCAS } from "../../packages/engine/src/stores/resource-cas";
import { createStateContainer } from "../../packages/engine/src/stores/state-container";
import {
  normalizeResourceDefault,
  normalizeResourceState
} from "../../packages/engine/src/resources/normalize-resource-state";
import { isRetryableError } from "../../packages/engine/src/execution/retry";
import { FlowError } from "../../packages/engine/src/errors/flow-error";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import {
  createExecutionContext,
  createInMemoryStores,
  type StoreRegistry
} from "../../packages/engine/src";
import type { ExpectedVersion } from "../../packages/engine/src/stores/types";
import { createScopePersist } from "../../packages/engine/src/stores/scope-persist";
import { createFilesystemSessionStore } from "../../packages/engine/src/stores/filesystem/session-store";
import { createFilesystemUserStore } from "../../packages/engine/src/stores/filesystem/user-store";
import { createFilesystemOrgStore } from "../../packages/engine/src/stores/filesystem/org-store";
import { createInMemorySessionStore } from "../../packages/engine/src/stores/memory/session-store";
import { createInMemoryUserStore } from "../../packages/engine/src/stores/memory/user-store";
import { createInMemoryOrgStore } from "../../packages/engine/src/stores/memory/org-store";

/**
 * Local structural stand-ins. The POC never leaves this file, and the shipped
 * generic types would need the flow's inferred resource map to line up — which
 * is machinery, not evidence.
 */
type PocState = Record<string, unknown>;
type MutableRef = {
  readonly state: PocState;
  updateState(updater: (s: PocState) => PocState | Promise<PocState>): Promise<void>;
};
type CollectionHandle = {
  create(key: string, initial?: PocState): Promise<MutableRef>;
  get(key: string): Promise<MutableRef>;
  getOptional(key: string): Promise<MutableRef | undefined>;
  delete(key: string): Promise<boolean>;
};

// ---------------------------------------------------------------------------
// 1. Is EVERY resource write version-checked? (§2 fold headline vs map row 10)
// ---------------------------------------------------------------------------

describe("§2 headline — resource writes are not all version-checked", () => {
  /** Drive the real driver and capture the expectedVersion it hands the store. */
  async function expectedVersionFor(
    intent: "mutate" | "create" | "replace",
    heldVersion: number
  ): Promise<ExpectedVersion> {
    const container = createStateContainer<Record<string, unknown>>({ a: 1 });
    container.commit({ a: 1 }, heldVersion);

    let seen: ExpectedVersion | undefined;
    await runResourceCAS({
      key: "k",
      container,
      mutator: () => ({ a: 2 }),
      persist: async (next, expectedVersion) => {
        seen = expectedVersion;
        return { ok: true, state: next, version: heldVersion + 1 };
      },
      reread: async () => ({ state: { a: 1 }, version: heldVersion }),
      intent
    });
    return seen as ExpectedVersion;
  }

  it("mutate writes at the version the context holds", async () => {
    expect(await expectedVersionFor("mutate", 3)).toBe(3);
  });

  it("create writes at 0 — 'no live row', still a check", async () => {
    expect(await expectedVersionFor("create", 0)).toBe(0);
  });

  it('replace writes at "any" — NO version check at all', async () => {
    // `create(..., { replace: true })` maps to intent "replace"
    // (`resource-registry.ts:1122`), and `resource-cas.ts:219-220` sends that
    // at "any". This is the row that falsifies "always version-checked".
    expect(await expectedVersionFor("replace", 3)).toBe("any");
  });
});

// ---------------------------------------------------------------------------
// 2. Does an array's custom own property reach the storage boundary at all?
// ---------------------------------------------------------------------------

describe("§7c array-custom-property row — the schema strips it first", () => {
  const withProp = (): unknown[] => {
    const arr: unknown[] = [1, 2, 3];
    (arr as unknown as Record<string, unknown>).custom = "KEEP-ME";
    return arr;
  };

  it("z.array(z.any()) rebuilds the array and the property is gone", () => {
    const arr = withProp();
    expect((arr as unknown as Record<string, unknown>).custom).toBe("KEEP-ME");

    const parsed = z.array(z.any()).parse(arr);

    expect(Object.prototype.hasOwnProperty.call(parsed, "custom")).toBe(false);
    // A NEW array — the property is not merely hidden, the value is rebuilt.
    expect(parsed).not.toBe(arr);
  });

  it("structuredClone WOULD keep it — so the stripper is Zod, not the adapter", () => {
    const cloned = structuredClone(withProp()) as unknown as Record<string, unknown>;
    expect(cloned.custom).toBe("KEEP-ME");
  });

  it("JSON.stringify drops it — the divergence is real ONLY past the schema", () => {
    const round = JSON.parse(JSON.stringify(withProp())) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(round, "custom")).toBe(false);
  });

  it("a passthrough z.any() is the one schema that lets it reach a store", () => {
    const parsed = z.any().parse(withProp()) as unknown as Record<string, unknown>;
    expect(parsed.custom).toBe("KEEP-ME");
  });
});

// ---------------------------------------------------------------------------
// 3. Does deleteStateRecord always persist at "any"? (§11 state-and-scopes)
// ---------------------------------------------------------------------------

const tmpRoot = mkdtempSync(join(tmpdir(), "fix1154-r25-"));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

const scopeStores: Record<string, Record<string, unknown>> = {
  "memory session": createInMemorySessionStore() as never,
  "memory user": createInMemoryUserStore() as never,
  "memory org": createInMemoryOrgStore() as never,
  "filesystem session": createFilesystemSessionStore({ rootDir: join(tmpRoot, "s") }) as never,
  "filesystem user": createFilesystemUserStore({ rootDir: join(tmpRoot, "u") }) as never,
  "filesystem org": createFilesystemOrgStore({ rootDir: join(tmpRoot, "o") }) as never
};

/**
 * Record what expectedVersion each verb receives.
 *
 * NB the argument positions differ, and getting this wrong is how a check aims
 * at a neighbour of its claim: `deleteField(id, path, expectedVersion, ...)` and
 * `set(id, record, expectedVersion)` carry it at args[2], but
 * `patchField(id, path, VALUE, expectedVersion, ...)` carries it at args[3].
 * The first version of this check read args[2] for patchField and reported the
 * patched VALUE as a version.
 */
const VERSION_ARG: Record<string, number> = {
  deleteField: 2,
  set: 2,
  patchField: 3
};

function probe(store: Record<string, unknown>, verbs: string[]) {
  const seen: { via: string; expectedVersion: unknown }[] = [];
  // An explicit facade, NOT Object.create(store) — inheriting through the
  // prototype would hand `createScopePersist` a verb the real store does not
  // advertise, which is the whole variable under test.
  const wrapped: Record<string, unknown> = {};
  for (const verb of verbs) {
    const original = store[verb];
    if (typeof original !== "function") continue;
    wrapped[verb] = async (...args: unknown[]) => {
      seen.push({ via: verb, expectedVersion: args[VERSION_ARG[verb]!] });
      return (original as (...a: unknown[]) => Promise<unknown>).apply(store, args);
    };
  }
  return { wrapped, seen };
}

async function route(
  store: Record<string, unknown>,
  id: string,
  verbs: string[],
  hint: Record<string, unknown>,
  nextState: unknown
) {
  await (store.set as (...a: unknown[]) => Promise<unknown>)(
    id,
    { id, state: { bag: { a: 1, b: 2 } }, version: 0, updatedAt: Date.now() },
    0
  );
  const { wrapped, seen } = probe(store, verbs);
  const ref = {
    current: { id, state: { bag: { a: 1, b: 2 } }, version: 1, updatedAt: Date.now() }
  };
  const persist = createScopePersist(
    ref as never,
    wrapped as never,
    (expectedVersion: number, state: unknown) => ({
      ...(ref.current as object),
      state,
      version: typeof expectedVersion === "number" ? expectedVersion + 1 : 1,
      updatedAt: Date.now()
    })
  );
  await persist(nextState as never, 1, hint as never);
  return seen[0];
}

describe("§11 deleteStateRecord — unchecked only where the adapter advertises the verb", () => {
  for (const [name, store] of Object.entries(scopeStores)) {
    const isFilesystem = name.startsWith("filesystem");

    it(`${name}: deleteField advertised === ${!isFilesystem}`, () => {
      expect(typeof store.deleteField === "function").toBe(!isFilesystem);
    });

    it(`${name}: routes deleteStateRecord ${isFilesystem ? "through a CHECKED set" : 'at "any"'}`, async () => {
      const row = await route(
        store,
        "scope-del",
        ["deleteField", "set"],
        { kind: "deleteField", path: ["bag", "b"] },
        { bag: { a: 1 } }
      );
      if (isFilesystem) {
        // No native verb -> `scope-persist.ts:147-148` falls back to
        // `store.set(id, record, expectedVersion)` at the HELD version.
        expect(row?.via).toBe("set");
        expect(row?.expectedVersion).toBe(1);
      } else {
        expect(row?.via).toBe("deleteField");
        expect(row?.expectedVersion).toBe("any");
      }
    });

    it(`${name}: setStateRecord still goes unchecked (the unaffected half)`, async () => {
      const row = await route(
        store,
        "scope-patch",
        ["patchField", "set"],
        { kind: "patchField", path: ["bag", "a"], commutative: true },
        { bag: { a: 9, b: 2 } }
      );
      expect(row?.via).toBe("patchField");
      expect(row?.expectedVersion).toBe("any");
    });
  }
});

// ---------------------------------------------------------------------------
// 4. When is a first-touch invalid write a SILENT NO-OP? (round-26 claim)
//
// §11 scoped the exception to "a schema with no valid complete default". Review
// argued the same no-op happens WITH a valid default, because the driver's
// short-circuit compares the NORMALIZED result against the seed — and an invalid
// candidate normalizes back to exactly that seed either way. If that holds, the
// operative condition is "normalization equals the first-touch seed", and the
// no-default case is one instance of it rather than the rule itself.
//
// Wired the way `resource-registry.ts` wires it: the container is seeded from
// `normalizeResourceDefault` at version 0, and the mutator handed to the driver
// is the caller's updater COMPOSED WITH `normalizeResourceState` — which is the
// detail the whole claim turns on.
// ---------------------------------------------------------------------------

describe("§11 first-touch no-op — the condition is the seed, not the default", () => {
  type Outcome = {
    committed: boolean;
    version: number;
    persisted: boolean;
    state: Record<string, unknown>;
  };

  /** First touch of a never-stored resource, exactly as the registry drives it. */
  async function firstTouch(
    config: { stateSchema: z.ZodTypeAny; default?: unknown },
    updater: (s: Record<string, unknown>) => Record<string, unknown>,
    stored?: { state: Record<string, unknown>; version: number }
  ): Promise<Outcome> {
    const cfg = config as unknown as Parameters<typeof normalizeResourceDefault>[0];
    const seed = stored ? stored.state : normalizeResourceDefault(cfg);
    const container = createStateContainer<Record<string, unknown>>(
      seed as Record<string, unknown>,
      stored ? stored.version : 0
    );

    let persisted = false;
    const res = await runResourceCAS({
      key: "k",
      container,
      // The registry's composition — `resource-registry.ts:664`.
      mutator: async (current) =>
        normalizeResourceState(cfg, updater(current as Record<string, unknown>)),
      persist: async (next) => {
        persisted = true;
        return { ok: true, state: next, version: (stored?.version ?? 0) + 1 };
      },
      // Never-stored unless the test says otherwise.
      reread: async () =>
        stored ? { state: stored.state, version: stored.version } : undefined,
      intent: "mutate"
    });

    return {
      committed: res.committed,
      version: res.version,
      persisted,
      state: res.state as Record<string, unknown>
    };
  }

  // A schema WITH a valid complete default — the case §11 said was unaffected.
  const withDefault = { stateSchema: z.object({ n: z.number().default(0) }) };
  // A schema with NO valid complete default — the case §11 did name.
  const noDefault = { stateSchema: z.object({ n: z.number() }) };

  it("CLAIM: valid default + INVALID first write is a silent no-op — no row, no version", async () => {
    // `{ n: "bad" }` fails `z.number()`, so `normalizeResourceState` falls back
    // to `normalizeResourceDefault` = `{ n: 0 }` — byte-for-byte the seed the
    // container already holds. The `deepEqual` at `resource-cas.ts:229` sees no
    // change and returns before persisting. The schema HAVING a default is what
    // makes seed and fallback identical, so a default does not protect against
    // this — it is the thing that produces it.
    const out = await firstTouch(withDefault, () => ({ n: "bad" }) as never);

    expect(out.committed).toBe(false);
    expect(out.version).toBe(0);
    expect(out.persisted).toBe(false); // nothing ever reached a store
    expect(out.state).toEqual({ n: 0 });
  });

  it("CONTROL: valid default + VALID first write DOES create — the harness can commit", async () => {
    // Without this, the row above proves only that the wiring never writes.
    const out = await firstTouch(withDefault, () => ({ n: 5 }));

    expect(out.committed).toBe(true);
    expect(out.version).toBe(1);
    expect(out.persisted).toBe(true);
    expect(out.state).toEqual({ n: 5 });
  });

  it("the no-default case behaves identically — one instance, not the rule", async () => {
    // §11's stated exception. Same outcome, same mechanism: the fallback is
    // `{}`, the seed is `{}`, they deep-equal. Nothing about it is special.
    const out = await firstTouch(noDefault, () => ({ n: "bad" }) as never);

    expect(out.committed).toBe(false);
    expect(out.version).toBe(0);
    expect(out.persisted).toBe(false);
    expect(out.state).toEqual({});
  });

  it("BOUNDARY: on a row that EXISTS the same invalid write is D1's replacement", async () => {
    // This is what makes "first touch" the operative word rather than "invalid".
    // The seed is the stored state, the fallback is the default, the two differ,
    // so the write commits — destroying `keep` and reporting success.
    const cfg = {
      stateSchema: z.object({
        n: z.number().default(0),
        keep: z.string().default("gone")
      })
    };
    const out = await firstTouch(cfg, () => ({ n: "bad" }) as never, {
      state: { n: 5, keep: "DO-NOT-LOSE" },
      version: 3
    });

    expect(out.committed).toBe(true);
    expect(out.version).toBe(4);
    expect(out.persisted).toBe(true);
    expect(out.state).toEqual({ n: 0, keep: "gone" }); // D1
  });
});

// ---------------------------------------------------------------------------
// 4b. Which axis actually decides it — driven through the REAL registry
//
// Round 26 re-cut §9/§11 on "row exists vs first touch". Round 28 says that
// axis is wrong too. Both earlier cuts were stated at the width of the single
// resource, which is the only handle the group above drives.
//
// The mechanism is one line — `resource-cas.ts:229` short-circuits when
// normalization returns what the container ALREADY HOLDS — and the two handles
// answer it differently because the normalizer is two copies with two
// different fallbacks (§7b):
//
//   single      seed(no row) = normalizeResourceDefault(config)   (:1494)
//               invalid      = normalizeResourceDefault(config)   (normalize-resource-state.ts:50)
//               the SAME FUNCTION — equal by construction
//
//   collection  seed(no row) = stateSchema.safeParse({})          (:712-713)
//               invalid      = bare {}                            (:680)
//               two different expressions — equal only by coincidence
//
// Everything below goes through `createExecutionContext` and the shipped
// collection handle. Nothing here hand-composes the registry: the group above
// does that, and a hand-composed harness can only ever execute this author's
// READING of the composition — the neighbour trap §10 records eight times.
// ---------------------------------------------------------------------------

describe("§9/§11 axis — normalization vs what the container holds, not row-existence", () => {
  const schemaWithDefaults = z.object({
    n: z.number().default(0),
    keep: z.string().default("seed")
  });

  const tasks = defineResourceCollection({
    scope: "session",
    pattern: "tasks/**",
    stateSchema: schemaWithDefaults
  });

  // Same schema as the collection, so every contrast below is handle-vs-handle
  // and never schema-vs-schema.
  const single = defineResource({
    scope: "session",
    ref: "single",
    stateSchema: schemaWithDefaults,
    default: { n: 0, keep: "seed" }
  });

  // A collection whose `safeParse({})` FAILS, so its seed and its invalid
  // fallback coincide at `{}` — the case that behaves like the single.
  const strict = defineResourceCollection({
    scope: "session",
    pattern: "strict/**",
    stateSchema: z.object({ n: z.number() })
  });

  const makeCtx = (stores: StoreRegistry, requestId: string) =>
    createExecutionContext({
      flow: defineFlow({
        kind: "fix1154-r28",
        actions: {
          run: {
            inputSchema: z.string(),
            block: handler({
              name: "noop",
              resources: { tasks, single, strict },
              execute: () => "ok"
            })
          }
        }
      })(),
      actionName: "run",
      requestId,
      sessionId: "sess_1",
      userId: "user_1",
      stores
    });

  const readRow = (stores: StoreRegistry, key: string) =>
    stores.resourceState.get("session", "sess_1", key);

  it("CLAIM: a collection row's invalid write lands {} — every field gone, schema defaults included", async () => {
    // The collection normalizer substitutes a BARE `{}` (`:680`). Nothing
    // survives — not the untouched field, not the fields the schema defaults.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_coll");
    await (ctx.resources.tasks as never as CollectionHandle).create("t1", {
      n: 5,
      keep: "DO-NOT-LOSE"
    });
    expect((await readRow(stores, "tasks/t1"))?.state).toEqual({ n: 5, keep: "DO-NOT-LOSE" });

    const inst = await (ctx.resources.tasks as never as CollectionHandle).get("t1");
    await inst.updateState(() => ({ n: "bad" }) as never);

    const after = await readRow(stores, "tasks/t1");
    expect(after?.state).toEqual({}); // NOT `{ n: 0, keep: "seed" }`
    expect(after?.version).toBe(2); // committed, and reported success
  });

  it("CONTRAST: the same schema and the same write on a SINGLE lands the schema DEFAULT", async () => {
    // D1 as §7b states it. The pair is the point: same schema, same candidate,
    // two different survivors — so "what the schema declares" cannot be the axis.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_single");
    const ref = ctx.resources.single as never as MutableRef;
    await ref.updateState(() => ({ n: 5, keep: "DO-NOT-LOSE" }));

    await ref.updateState(() => ({ n: "bad" }) as never);

    const after = await readRow(stores, "single");
    expect(after?.state).toEqual({ n: 0, keep: "seed" }); // the default, not {}
    expect(after?.version).toBe(2);
  });

  it("the first-touch no-op is a SINGLE-side guarantee — seed and fallback are one function", async () => {
    // Never-persisted single, invalid first write: `normalizeResourceState`
    // falls back to exactly what the container was seeded with, the deep-equal
    // fires, and nothing reaches a store. This is round 26's claim on the real
    // path rather than on a composed harness.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_first");

    await expect(
      (ctx.resources.single as never as MutableRef).updateState(() => ({ n: "bad" }) as never)
    ).resolves.toBeUndefined();

    expect(await readRow(stores, "single")).toBeUndefined();
  });

  it("SCOPE: a never-created collection instance cannot be reached at all", async () => {
    // This is what stops the collection's `{}` fallback from being a
    // first-touch defect: there is no first touch to have. Recorded because
    // without it the rows above read as a wider blast radius than exists.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_scope");
    const handle = ctx.resources.tasks as never as CollectionHandle;

    await expect(handle.get("never")).rejects.toThrow(/not found in collection/);
    expect(await handle.getOptional("never")).toBeUndefined();
  });

  it("SCOPE: create() VALIDATES and throws — the silent {} is only reachable through a held ref", async () => {
    // The other half of the scope. `create` parses the initial state and raises
    // a named error naming the failing path (`resource-registry.ts:1102`;
    // `upsert` does the same at `:1280`), so neither way IN to a collection
    // instance carries the defect — only the three per-instance write ops do.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_create");

    await expect(
      (ctx.resources.tasks as never as CollectionHandle).create("t2", { n: "bad" } as never)
    ).rejects.toThrow(/state validation failed/);
    expect(await readRow(stores, "tasks/t2")).toBeUndefined();
  });

  it("BOUNDARY: a held ref whose row was deleted recreates it holding {}", async () => {
    // The one reachable place where the collection's seed is the schema default
    // and its fallback is `{}`: after `delete`, the cache entry is gone, so
    // `readState()` takes the `safeParse({})` branch (:712-713) while the write
    // still returns `{}`. They differ, so the write commits.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_del");
    const handle = ctx.resources.tasks as never as CollectionHandle;
    await handle.create("t3", { n: 5, keep: "DO-NOT-LOSE" });
    const inst = await handle.get("t3");
    await handle.delete("t3");
    expect(await readRow(stores, "tasks/t3")).toBeUndefined();

    await inst.updateState(() => ({ n: "bad" }) as never);

    expect((await readRow(stores, "tasks/t3"))?.state).toEqual({});
  });

  it("CONTROL: a VALID write on that same ref recreates it too — so the revival is D5, only the {} is the normalizer", async () => {
    // Without this the row above would read as "the invalid write resurrects
    // it", which is wrong and would re-file D5 under a new name. The revival is
    // the tombstone branch (D5 / FIX-1258); what the normalizer decides is only
    // WHAT the recreated row holds.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_del_valid");
    const handle = ctx.resources.tasks as never as CollectionHandle;
    await handle.create("t4", { n: 5, keep: "DO-NOT-LOSE" });
    const inst = await handle.get("t4");
    await handle.delete("t4");

    await inst.updateState((s) => ({ ...s, n: 9 }));

    expect((await readRow(stores, "tasks/t4"))?.state).toEqual({ n: 9, keep: "seed" });
  });

  it("a collection whose safeParse({}) FAILS is a no-op — the two fallbacks coincide at {}", async () => {
    // So "collection" is not the axis either. With a required field,
    // `readState()` falls through to `{}`, the invalid write returns `{}`, the
    // deep-equal fires, and nothing is written. The divergence is between the
    // two FALLBACKS, not between the two handles.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_strict");
    const handle = ctx.resources.strict as never as CollectionHandle;
    await handle.create("s1", { n: 5 });
    const inst = await handle.get("s1");
    await handle.delete("s1");

    await inst.updateState(() => ({ n: "bad" }) as never);

    expect(await readRow(stores, "strict/s1")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. D6's third condition — an allowlist does not mean "no replay"
//
// The spec (and the FIX-1265 issue body) said the replay needs `retryableErrors`
// UNSET OR EMPTY. `isRetryableError` classifies by `instanceof` over the listed
// constructors (`execution/retry.ts:89`), and both read-only refusals are plain
// `Error`s — so an allowlist that happens to CONTAIN a matching class replays
// them too. That makes the stated predicate a strict subset of the defect, and
// a verification scoped to it would miss the case.
// ---------------------------------------------------------------------------

describe("D6 third condition — a MATCHING allowlist replays the refusal too", () => {
  // The exact shape both read-only guards throw:
  // `resource-registry.ts:659` (state) and `:1636` (content).
  const readOnlyRefusal = new Error('Resource "stats" is read-only');

  const policy = (retryableErrors?: Array<new (...args: never[]) => Error>) => ({
    maxAttempts: 2,
    baseDelayMs: 0,
    maxDelayMs: 0,
    ...(retryableErrors ? { retryableErrors } : {})
  });

  it("unset — retryable (the condition the spec already stated)", () => {
    expect(isRetryableError(readOnlyRefusal, policy())).toBe(true);
  });

  it("empty list — retryable (the other half the spec already stated)", () => {
    expect(isRetryableError(readOnlyRefusal, policy([]))).toBe(true);
  });

  it("CLAIM: a NON-EMPTY list containing a matching class is ALSO retryable", () => {
    // `[Error]` is not exotic — it is what a caller writes to mean "retry
    // ordinary failures". Every plain Error is an `instanceof Error`.
    expect(isRetryableError(readOnlyRefusal, policy([Error]))).toBe(true);
  });

  it("a superclass match counts — TypeError refusals are caught by [Error] too", () => {
    // The `instanceof` is over the prototype chain, not an identity check, so
    // "contains the error's class" is too narrow as well: it is "contains a
    // class the error is an instanceof".
    expect(isRetryableError(new TypeError("bad delta"), policy([Error]))).toBe(true);
  });

  it("CONTROL: a non-matching allowlist does NOT retry — the exclusion is real", () => {
    // Without this the rows above prove only that the classifier says yes a lot.
    // A plain Error is not a FlowError, so this is the case where an allowlist
    // genuinely stops the replay.
    expect(isRetryableError(readOnlyRefusal, policy([FlowError]))).toBe(false);
  });

  it("CONTROL: no policy at all is not retryable — the safe default is unchanged", () => {
    // `mergeRetryPolicy` returns `undefined` for an unconfigured block
    // (`execution/retry.ts:34-36`), and `isRetryableError` returns false for it
    // (`:63-65`). The defect stays latent, which is the half that is correct.
    expect(isRetryableError(readOnlyRefusal, undefined)).toBe(false);
  });
});
