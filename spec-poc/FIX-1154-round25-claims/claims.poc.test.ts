/**
 * FIX-1154 — round-25 claim checks. Throwaway; never merges.
 *
 * WHY A THIRD FILE
 * Round 25 corrected three factual claims in the write-up. Each was argued from
 * a code read on one side and a review comment on the other, and this document's
 * own §10 rule is that a claim about runtime behaviour is settled by running it.
 * They live here rather than in `FIX-1154-resource-mutation-verbs/` so that
 * suite's "twenty-four rows" stays an accurate count — adding rows to it would
 * have made §10's own figure stale, which is the exact defect round 24 recorded.
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
 *
 * These drive real modules — `runResourceCAS`, the repo's Zod, `createScopePersist`
 * over the real memory and filesystem scope stores. No mocked stores.
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
import type { ExpectedVersion } from "../../packages/engine/src/stores/types";
import { createScopePersist } from "../../packages/engine/src/stores/scope-persist";
import { createFilesystemSessionStore } from "../../packages/engine/src/stores/filesystem/session-store";
import { createFilesystemUserStore } from "../../packages/engine/src/stores/filesystem/user-store";
import { createFilesystemOrgStore } from "../../packages/engine/src/stores/filesystem/org-store";
import { createInMemorySessionStore } from "../../packages/engine/src/stores/memory/session-store";
import { createInMemoryUserStore } from "../../packages/engine/src/stores/memory/user-store";
import { createInMemoryOrgStore } from "../../packages/engine/src/stores/memory/org-store";

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
