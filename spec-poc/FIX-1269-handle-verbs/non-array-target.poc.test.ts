/**
 * FIX-1269 — characterization POC. Throwaway; never merges.
 *
 * WHAT THIS IS
 * FIX-1269 adds `incState` / `pushState` to the resource handles. The issue
 * flagged one open risk: FIX-1255 found that the BAG's `pushToArray` behaved
 * three different ways per adapter when the target field already held a
 * non-array, and asked that the new resource verbs "not inherit that
 * divergence". This file establishes what the two primitives actually do today,
 * so the spec's decision on the non-array target rests on a run rather than on
 * a reading of an issue that has since been fixed.
 *
 * WHY IT IS NOT A SECOND ATOMICITY POC
 * The claim that these verbs are CAS-atomic — the one the epic says FIX-1269's
 * documentation must not get backwards — is ALREADY pinned, on the sibling
 * branch: `spec-poc/FIX-1154-resource-mutation-verbs/policy-rows.poc.test.ts`
 * (PR #1445) drives increment and append as mutator bodies over the same
 * `runResourceCAS` path under `intent: "mutate"` and shows two contexts both
 * landing. Re-running it here would add a second carrier of one result. It is
 * cited in §7 instead.
 *
 * HOW IT DRIVES THE REAL PATH
 * Two execution contexts over real stores, no mocks. The bag rows call the
 * shipped `ctx.session.pushState` directly. The resource rows perform the
 * append the only way `main` allows — as a mutator body handed to the ref's own
 * `updateState`, which is the same per-key write queue, the same
 * `mutateResourceKey`, the same `runResourceCAS` and the same schema
 * normalization the new verbs will take.
 *
 * WHERE THE MODEL STOPS
 * It says nothing about store-native delta verbs (Tier 2 / FIX-1267, deferred),
 * and it does not model the proposed API — `appendVia` is today's spelling of
 * tomorrow's `pushState`, not a prototype of it.
 *
 * RUN IT
 *   pnpm install
 *   cd spec-poc/FIX-1269-handle-verbs && ../../node_modules/.bin/vitest run
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResource, handler } from "@flow-state-dev/core";
import {
  createExecutionContext,
  createInMemoryStores,
  type StoreRegistry
} from "../../packages/engine/src";
import { createSQLiteStores } from "../../packages/store-sqlite/src";

type PocState = Record<string, unknown>;

/**
 * A resource whose array-ish field is a UNION, so a scalar can legitimately be
 * stored there and the non-array case is reachable at all. The closed
 * `z.array(...)` case is a row of its own below — the two together are what
 * size the decision.
 *
 * `keep` is the untouched-field control: the interesting failure is not a bad
 * value landing, it is a prior value disappearing while the call reports
 * success, and only an unrelated field shows that clearly.
 */
const loose = defineResource({
  scope: "session",
  ref: "loose",
  stateSchema: z.object({
    items: z.union([z.string(), z.array(z.any())]).default([]),
    keep: z.string().default("untouched")
  }),
  default: { items: [], keep: "untouched" } as never
});

/** The ordinary shape: the field is declared an array and nothing else fits. */
const strict = defineResource({
  scope: "session",
  ref: "strict",
  stateSchema: z.object({
    items: z.array(z.string()).default([]),
    keep: z.string().default("untouched")
  }),
  default: { items: [], keep: "untouched" }
});

function makeFlow() {
  return defineFlow({
    kind: "fix1269-poc",
    // Permissive on purpose: the bag rows need a field that can hold a scalar
    // first and be pushed to second.
    sessionStateSchema: z.object({}).passthrough(),
    actions: {
      run: {
        inputSchema: z.string(),
        block: handler({
          name: "noop",
          resources: { loose, strict },
          execute: () => "ok"
        })
      }
    }
  })();
}

function makeCtx(stores: StoreRegistry, requestId: string) {
  return createExecutionContext({
    flow: makeFlow(),
    actionName: "run",
    requestId,
    sessionId: "sess_1",
    userId: "user_1",
    stores
  });
}

type SessionOps = {
  patchState: (updates: PocState) => Promise<boolean>;
  pushState: (field: string, value: unknown) => Promise<boolean>;
};

type MutableRef = {
  state: Readonly<PocState>;
  updateState(updater: (s: PocState) => PocState | Promise<PocState>): Promise<void>;
};

/**
 * Today's spelling of the append FIX-1269 will ship, written the way an
 * implementer porting `state-container.ts`'s `pushState` body would write it —
 * `toArray` coerces a non-array to `[]`. That coercion is the whole subject of
 * the resource rows below.
 */
const toList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function appendVia(ref: MutableRef, field: string, value: unknown): Promise<void> {
  return ref.updateState((s) => {
    const next = { ...s } as Record<string, unknown>;
    next[field] = [...toList(next[field]), value];
    return next as PocState;
  });
}

const readRow = (stores: StoreRegistry, key: string) =>
  stores.resourceState.get("session", "sess_1", key);

const freshSqlite = () => createSQLiteStores({ filename: ":memory:" }) as StoreRegistry;

// ---------------------------------------------------------------------------
// The bag side — what FIX-1255 left behind, measured rather than relayed.
// ---------------------------------------------------------------------------

describe("bag pushState onto a non-array target", () => {
  for (const [label, freshStores] of [
    ["memory", () => createInMemoryStores()],
    ["sqlite", freshSqlite]
  ] as const) {
    it(`${label}: refuses the write and leaves the prior value intact`, async () => {
      const stores = freshStores();
      const ctx = await makeCtx(stores, `req_${label}`);
      const session = ctx.session as unknown as SessionOps;

      await session.patchState({ items: "a scalar", keep: "untouched" });

      // FIX-1255's settled behaviour: throw. If this row ever goes green with a
      // different outcome, the bag moved and the resource contract in §6
      // decision 2 has to be revisited alongside it.
      await expect(session.pushState("items", "x")).rejects.toThrow(/not an array/);

      const row = await stores.session.get("sess_1");
      expect((row?.state as PocState).items).toBe("a scalar");
      expect((row?.state as PocState).keep).toBe("untouched");
    });

    it(`${label}: but incState on a NON-NUMERIC target silently coerces and destroys it`, async () => {
      // The bag's two verbs disagree with each other. `pushToArray` refuses a
      // wrong-typed target; `incField` takes `typeof existing === "number" ?
      // existing : 0` as its baseline and overwrites. FIX-1255 fixed the first
      // across adapters and explicitly left the second ("worth checking
      // `incField` against a non-numeric value while in here") out of scope.
      //
      // This row is why FIX-1269's contract cannot be stated as "match the
      // bag": there is no single bag behaviour to match.
      const stores = freshStores();
      const ctx = await makeCtx(stores, `req_${label}_inc`);
      const session = ctx.session as unknown as SessionOps & {
        incState: (incs: Record<string, number>) => Promise<boolean>;
      };

      await session.patchState({ n: "not a number", keep: "untouched" });
      await session.incState({ n: 1 });

      const row = await stores.session.get("sess_1");
      expect((row?.state as PocState).n).toBe(1);
      expect((row?.state as PocState).keep).toBe("untouched");
    });
  }
});

// ---------------------------------------------------------------------------
// The resource side — the trap, and how far it reaches.
// ---------------------------------------------------------------------------

describe("resource append onto a non-array target", () => {
  it(
    "TRAP: porting the bag's container-level mutator DESTROYS the scalar and reports success",
    async () => {
      const stores = createInMemoryStores();
      const ctx = await makeCtx(stores, "req_trap");
      const ref = ctx.resources.loose as unknown as MutableRef;

      await ref.updateState((s) => ({ ...s, items: "a scalar", keep: "untouched" }));
      expect((await readRow(stores, "loose"))?.state).toMatchObject({ items: "a scalar" });

      // No throw. `toArray` swallowed the scalar and the append succeeded.
      await appendVia(ref, "items", "x");

      const state = (await readRow(stores, "loose"))?.state as PocState;
      expect(state.items).toEqual(["x"]);
      expect(state.keep).toBe("untouched");

      // Which is the opposite of what the bag does on the identical input. An
      // implementer who "matches the bag" by copying its mutator body ships
      // this, silently, on every adapter.
    }
  );

  it("the resource path never reaches a store delta verb, so no adapter can diverge", async () => {
    // Same mutator, both adapters, identical outcome — because
    // `persistResourceState` always persists a full-record `set` and the
    // resource write path has no hint surface to route a `pushToArray` through.
    // This is why FIX-1255's per-adapter divergence cannot be inherited, and
    // equally why the behaviour is ours to choose rather than to match.
    const outcomes: unknown[] = [];
    for (const freshStores of [() => createInMemoryStores(), freshSqlite]) {
      const stores = freshStores();
      const ctx = await makeCtx(stores, "req_uniform");
      const ref = ctx.resources.loose as unknown as MutableRef;
      await ref.updateState((s) => ({ ...s, items: "a scalar", keep: "untouched" }));
      await appendVia(ref, "items", "x");
      outcomes.push((await readRow(stores, "loose"))?.state);
    }
    expect(outcomes[0]).toEqual(outcomes[1]);
  });

  it("SIZE OF THE PROBLEM: a closed array schema refuses the scalar before any append", async () => {
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_strict");
    const ref = ctx.resources.strict as unknown as MutableRef;

    // `parseResourceWriteState` runs inside the mutator, so the scalar never
    // lands in the first place on an ordinary array-typed field. The non-array
    // target is only reachable on a resource whose schema permits it — which is
    // what makes this a narrow contract question rather than a broad one.
    await expect(
      ref.updateState((s) => ({ ...s, items: "a scalar" }))
    ).rejects.toThrow();

    expect((await readRow(stores, "strict"))?.state ?? undefined).toBeUndefined();
  });
});
