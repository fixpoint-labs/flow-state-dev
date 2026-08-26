/**
 * FIX-1154 — claim checks for rounds 25, 26, 28 and 30. Throwaway; never merges.
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
 *  4. RE-CUT ROUND 33 — see below.
 *  5. D6's replay predicate required `retryableErrors` unset or empty. A
 *     non-empty allowlist containing a matching class replays it too.
 *
 * These drive real modules — `runResourceCAS`, the repo's Zod,
 * `createScopePersist` over the real memory and filesystem scope stores, and
 * (group 4b) `createExecutionContext` with the shipped collection handle. No
 * mocked stores anywhere.
 *
 * ROUND 33 — WHAT MOVED, AND WHAT THE RUN ITSELF SHOWED
 * #1469 (`47869f9c`) made both resource handles parse a write result through
 * one shared `parseResourceWriteState`, which THROWS instead of substituting a
 * default. Groups 1, 2, 3 and 5 are untouched by it and still pass. Group 4 is
 * RETIRED and group 4b is re-cut; their own headers carry the detail.
 *
 * The re-run is the point, not the edit. Ten rows across this file and
 * `../FIX-1154-resource-mutation-verbs/` went red, all on one cause — and
 * group 4, the only group that hand-composed the registry instead of driving
 * it, stayed GREEN while the real-registry rows beside it failed. A harness
 * that reproduces the code under test cannot notice when the code under test
 * changes. That is this suite's own §10 lesson, arriving one layer down.
 *
 * These files are run from the spec branch AFTER `origin/main` was merged into
 * it, so the engine source they import is `main`'s. Before that merge the
 * branch's base was 178 commits behind and a green run here would have been
 * evidence about the base, not about the product.
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
import { FlowError, ValidationError } from "../../packages/engine/src/errors/flow-error";
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
// 4. RETIRED — round 33. "When is a first-touch invalid write a SILENT NO-OP?"
//
// This group hand-composed the registry's mutator to settle whether the no-op
// turned on the SEED or on the schema's DEFAULT. Its answer (the seed) was
// right for `2e046e96`, and it is now unreachable: #1469 (`47869f9c`) made the
// registry compose `parseResourceWriteState`, which THROWS on an invalid
// candidate before `runResourceCAS` compares anything. There is no longer a
// normalized-result-versus-seed comparison on the invalid path to have a
// condition about.
//
// RETIRED RATHER THAN REWRITTEN, and the reason is the finding. Re-run against
// `main` this group stayed GREEN while group 4b, which drives the real
// registry, went red on every equivalent row. It passed because it executes
// this author's hand-written copy of a composition that no longer ships — the
// exact "neighbour of the claim" trap its own header warned about, turned on
// itself. A harness that reproduces the code under test cannot notice when the
// code under test changes. Rewriting it to compose `parseResourceWriteState`
// would only re-assert "it throws", which group 4b now establishes on the real
// path with no hand-composition at all.
//
// -4 rows here. With group 4b's own re-cut (-2 retired, +3 added) the suite
// moves 45 -> 42. §10 quotes the runner's line rather than this arithmetic.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 4b. What an invalid write does now — driven through the REAL registry
//
// RE-CUT ROUND 33, against `main` at `b8837e2a`. Every row in this group used
// to pin the normalization-versus-seed axis: an invalid candidate normalized to
// a fallback, `resource-cas.ts` short-circuited when that fallback equalled
// what the container held, and the two handles answered differently because the
// normalizer was two copies with two different fallbacks (single ->
// `normalizeResourceDefault`, collection -> a bare `{}`).
//
// #1469 (`47869f9c`) removed the premise. Both handles now call ONE shared
// `parseResourceWriteState` inside the mutator — `resource-registry.ts:677`
// (`persistResourceState`) and `:696` (`persistNamespaceInstanceState`) — and it
// THROWS `ValidationError` (`retryable: false`) rather than returning a
// substitute. So there is no fallback to compare, no short-circuit to reach,
// and no divergence between the handles. The axis is retired, not re-cut.
//
// What these rows pin instead is the new observable, in every position the old
// ones covered, because "it throws" is only half the claim — the other half is
// that the row it would have overwritten is still there, at its old version.
//
// Everything below goes through `createExecutionContext` and the shipped
// collection handle. Nothing here hand-composes the registry, and group 4's
// retirement note says why that now matters more than it did.
// ---------------------------------------------------------------------------

describe("§9/§11 — an invalid write is refused on BOTH handles, and the row survives", () => {
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

  // Accepts the object, a bare string, OR null — so one resource reaches both
  // of `parseResourceWriteState`'s non-object branches: the null it maps to
  // `{}`, and the schema-VALID non-object it refuses anyway.
  const nullable = defineResource({
    scope: "session",
    ref: "nullable",
    stateSchema: z.union([schemaWithDefaults, z.string()]).nullable(),
    default: { n: 0, keep: "seed" }
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
              resources: { tasks, single, strict, nullable },
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

  /** Run an invalid write and hand back whatever it threw (or `undefined`). */
  const refusalFrom = (write: Promise<unknown>) =>
    write.then(
      () => undefined,
      (e: unknown) => e
    );

  it("an EXISTING collection row: refused, and every field survives", async () => {
    // Was: "lands {} — every field gone, schema defaults included". The
    // collection's bare-`{}` substitution is gone with the shared write parse.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_coll");
    await (ctx.resources.tasks as never as CollectionHandle).create("t1", {
      n: 5,
      keep: "DO-NOT-LOSE"
    });
    expect((await readRow(stores, "tasks/t1"))?.state).toEqual({ n: 5, keep: "DO-NOT-LOSE" });

    const inst = await (ctx.resources.tasks as never as CollectionHandle).get("t1");
    const caught = await refusalFrom(inst.updateState(() => ({ n: "bad" }) as never));

    expect(caught).toBeInstanceOf(ValidationError);
    // The storage KEY is what the error names on this handle, not the accessor.
    expect((caught as Error).message).toMatch(/^Resource "tasks\/t1" write failed/);
    const after = await readRow(stores, "tasks/t1");
    expect(after?.state).toEqual({ n: 5, keep: "DO-NOT-LOSE" }); // NOT {}
    expect(after?.version).toBe(1); // NOT 2 — nothing was committed
  });

  it("an EXISTING single: refused identically — the handle split is CLOSED", async () => {
    // Was the CONTRAST row: same schema, same candidate, two different
    // survivors (`{}` vs the schema default), which was §7b's "the normalizer
    // is two copies" hazard made visible. Both handles now route through one
    // `parseResourceWriteState`, so the pair that used to differ is identical —
    // and THAT is the row worth keeping, as the evidence the hazard closed.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_single");
    const ref = ctx.resources.single as never as MutableRef;
    await ref.updateState(() => ({ n: 5, keep: "DO-NOT-LOSE" }));

    const caught = await refusalFrom(ref.updateState(() => ({ n: "bad" }) as never));

    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as Error).message).toMatch(/^Resource "single" write failed/);
    const after = await readRow(stores, "single");
    expect(after?.state).toEqual({ n: 5, keep: "DO-NOT-LOSE" }); // not the default
    expect(after?.version).toBe(1);
  });

  it("the refusal is TERMINAL — the contrast with D6's misclassified refusals", async () => {
    // Worth its own row because the whole D6 cluster is about a refusal that
    // no retry can fix being classified as one a retry might. The new write
    // refusal gets that right: `ValidationError` is a `FlowError` carrying
    // `retryable: false`, which `isRetryableError` stops at its FlowError
    // branch whatever the block's policy says.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_terminal");
    const ref = ctx.resources.single as never as MutableRef;
    await ref.updateState(() => ({ n: 5, keep: "DO-NOT-LOSE" }));

    const caught = (await refusalFrom(
      ref.updateState(() => ({ n: "bad" }) as never)
    )) as Error;

    expect(caught).toBeInstanceOf(FlowError);
    // Even the permissive allowlist that replays D6's refusals stops here.
    expect(
      isRetryableError(caught, { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 })
    ).toBe(false);
    expect(
      isRetryableError(caught, {
        maxAttempts: 3,
        baseDelayMs: 0,
        maxDelayMs: 0,
        retryableErrors: [Error]
      })
    ).toBe(false);
  });

  it("a NEVER-STORED single: refused too — the silent first touch is gone", async () => {
    // Was "a SINGLE-side guarantee — seed and fallback are one function": the
    // invalid first write normalized back to exactly the seed, the deep-equal
    // fired, and nothing reached a store. The caller was told nothing.
    // Now they are told, and the store is still untouched.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_first");

    const caught = await refusalFrom(
      (ctx.resources.single as never as MutableRef).updateState(() => ({ n: "bad" }) as never)
    );

    expect(caught).toBeInstanceOf(ValidationError);
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

  it("BOUNDARY: a held ref whose row was deleted is refused — no {} row is recreated", async () => {
    // Was "recreates it holding {}": after `delete` the seed became
    // `safeParse({})` while the invalid write still returned `{}`, they
    // differed, and the write committed an empty row onto a tombstone. The
    // refusal now stops it before the tombstone branch is reached at all — so
    // this path no longer creates anything.
    //
    // Read this row WITH the control below it: the two together are what keep
    // D5 correctly attributed. The revival is the tombstone branch, not the
    // normalizer, so closing the normalizer half must NOT read as closing D5.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_del");
    const handle = ctx.resources.tasks as never as CollectionHandle;
    await handle.create("t3", { n: 5, keep: "DO-NOT-LOSE" });
    const inst = await handle.get("t3");
    await handle.delete("t3");
    expect(await readRow(stores, "tasks/t3")).toBeUndefined();

    const caught = await refusalFrom(inst.updateState(() => ({ n: "bad" }) as never));

    expect(caught).toBeInstanceOf(ValidationError);
    expect(await readRow(stores, "tasks/t3")).toBeUndefined(); // still nothing
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

  it("a collection whose safeParse({}) FAILS: refused as well — one rule, no special cases", async () => {
    // Was "a no-op — the two fallbacks coincide at {}", kept then to show that
    // "collection" was not the axis either. It now makes a simpler point: the
    // schema shape that used to change the outcome no longer changes anything,
    // because the refusal happens before any fallback is chosen.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_strict");
    const handle = ctx.resources.strict as never as CollectionHandle;
    await handle.create("s1", { n: 5 });
    const inst = await handle.get("s1");
    await handle.delete("s1");

    const caught = await refusalFrom(inst.updateState(() => ({ n: "bad" }) as never));

    expect(caught).toBeInstanceOf(ValidationError);
    expect(await readRow(stores, "strict/s1")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Round 30's two rows are RETIRED here (-2). They existed to falsify §11's
  // universal phrasing ("every existing single is replaced by its defaults",
  // "every existing collection row by {}") by showing a row that already HELD
  // the fallback took no write. There is no replacement left to be universal
  // about, so the exception has nothing to be an exception to.
  //
  // What replaces them is the positive form, which is one row rather than two:
  // the outcome no longer depends on what the row currently holds. That is
  // worth pinning because it is exactly the state-dependence a docs page would
  // otherwise have to describe, and §11's brief now says there is none.
  // -------------------------------------------------------------------------
  it("the outcome does NOT depend on what the row already holds — no state-dependent case left", async () => {
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_at_default");
    const ref = ctx.resources.single as never as MutableRef;

    // Bring the row to exactly the schema defaults, so it holds what the old
    // fallback would have substituted — the case that used to be a silent
    // no-op while a differing row took a destructive write.
    await ref.updateState(() => ({ n: 5, keep: "DO-NOT-LOSE" }));
    await ref.updateState(() => ({ n: 0, keep: "seed" }));
    const before = await readRow(stores, "single");
    expect(before?.state).toEqual({ n: 0, keep: "seed" });
    expect(before?.version).toBe(2);

    const caught = await refusalFrom(ref.updateState(() => ({ n: "bad" }) as never));

    // Same refusal as the row holding different data, two tests above.
    expect(caught).toBeInstanceOf(ValidationError);
    const after = await readRow(stores, "single");
    expect(after?.state).toEqual({ n: 0, keep: "seed" });
    expect(after?.version).toBe(2);
  });

  it("the ONE write that still clears state: schema-valid null persists as {}", async () => {
    // Not a defect and not an exception to the rule above — the rule is about
    // candidates the schema REJECTS. A `.nullable()` resource ACCEPTS null, so
    // `setState(null)` is a valid write, and `parseResourceWriteState` maps it
    // to `{}` because the store holds `JsonObject`. Pinned because it is the
    // only remaining path where a write empties a row, and §11's brief has to
    // say so or a reader will read "invalid writes are refused" as "nothing
    // can clear my state".
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "r_nullable");
    const ref = ctx.resources.nullable as never as MutableRef;

    await ref.updateState(() => ({ n: 5, keep: "DO-NOT-LOSE" }));
    expect((await readRow(stores, "nullable"))?.state).toEqual({ n: 5, keep: "DO-NOT-LOSE" });

    await ref.updateState(() => null as never);

    const after = await readRow(stores, "nullable");
    expect(after?.state).toEqual({});
    expect(after?.version).toBe(2); // a real, committed write

    // The boundary: a schema-valid NON-object that is not null still throws,
    // so "valid parse" is not by itself the admitting condition.
    const caught = await refusalFrom(ref.updateState(() => "cleared" as never));
    expect(caught).toBeInstanceOf(ValidationError);
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
