/**
 * FIX-1154 — characterization POC. Throwaway; never merges.
 *
 * WHAT THIS IS
 * The evidence base for FIX-1154's mutation-surface gap write-up. Every row
 * characterizes what the resource write path does on `main` TODAY. Nothing here
 * models a proposed API: D-6 (#1446) settled that resources do not get
 * `incState` / `pushState` this cycle, and the issue ships the map of the
 * differences instead.
 *
 * HOW IT DRIVES THE REAL PATH
 * Increments and appends on a resource are performed the only way `main` allows
 * — as mutator bodies handed to the ref's own `updateState`, which is the same
 * per-key write queue, the same `mutateResourceKey`, the same `runResourceCAS`
 * under `intent: "mutate"` and the same schema normalization that every shipped
 * resource write takes. `incrementVia` / `appendVia` below are those mutator
 * bodies. Two execution contexts over one shared store, no mocks.
 *
 * WHERE THE MODEL STOPS
 * This is evidence about the version-checked write path. It says nothing about
 * a store-native delta verb; that tier is DEFERRED (§6 decision 2, D-6) and
 * nothing here would carry over to it. It also drives `createExecutionContext`
 * directly — deliberately, because that isolates the CAS driver — so it never
 * traverses `runAction`.
 *
 * THE ROWS THAT PIN DEFECTS
 * Several rows assert behaviour that is WRONG and is meant to be. They pin the
 * six defects the write-up documents (§7b), so a fix landing shows up as that
 * row failing rather than as a silent divergence. Each is labelled inline.
 * They exist because prose kept getting these rules wrong — three review rounds
 * in a row corrected them, each time enumerating the value kinds known at the
 * time and each time missing a neighbour. Running them is cheaper than arguing
 * them.
 *
 * RUN IT
 *   pnpm install
 *   cd spec-poc/FIX-1154-resource-mutation-verbs && ../../node_modules/.bin/vitest run
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import {
  createExecutionContext,
  createInMemoryStores,
  ResourceDeletedError,
  type StoreRegistry
} from "../../packages/engine/src";
import { createInternalResponseEmitter } from "../../packages/engine/src/streaming/response-emitter";
import { isRetryableError } from "../../packages/engine/src/execution/retry";
import { FlowError } from "../../packages/engine/src/errors/flow-error";

/** Local stand-in for the framework's `JsonObject` — the POC never leaves this file. */
type PocState = Record<string, unknown>;

const counter = defineResource({
  scope: "session",
  ref: "counter",
  stateSchema: z.object({
    n: z.number().default(0),
    log: z.array(z.string()).default([])
  }),
  default: { n: 0, log: [] },
  // `live` is what makes this resource's change seam fire at all — a non-live,
  // non-reactive single stays silent regardless, so without it the "no event on
  // a no-op" assertions below would pass vacuously.
  client: { live: true, expose: ["n", "log"] }
});

const tasks = defineResourceCollection({
  scope: "session",
  pattern: "tasks/**",
  // CLOSED, not `.passthrough()` — the ordinary shape, so the rows below
  // characterize the ordinary case rather than an open-schema edge.
  stateSchema: z.object({
    n: z.number().default(0),
    log: z.array(z.string()).default([])
  })
});

/**
 * A resource whose array field is `z.array(z.any())` and which carries a
 * SECOND, unrelated field. Both matter:
 *
 *  - `z.any()` is the schema that accepts every hazardous value, so a narrower
 *    one would show nothing about what the storage layer does with them.
 *  - `keep` is the untouched-field control. The failure these rows characterize
 *    is not a bad value being stored; it is the WHOLE STATE being reset while
 *    the call reports success, and only an unrelated field can show that.
 */
const bag = defineResource({
  scope: "session",
  ref: "bag",
  stateSchema: z.object({
    n: z.number().default(0),
    keep: z.string().default("schema-default"),
    items: z.array(z.any()).default([])
  }),
  default: { n: 0, keep: "schema-default", items: [] }
});

/**
 * A SAME-TYPE transform — output type === input type — which is what makes the
 * drift below invisible to any check stated over the handle's type. It drifts
 * because `normalizeResourceState` stores the OUTPUT of `safeParse`. Defect D3
 * / FIX-1260.
 */
const drifting = defineResource({
  scope: "session",
  ref: "drifting",
  stateSchema: z.object({
    n: z.number().default(0).transform((v) => v + 1)
  }),
  default: { n: 0 }
});

// Two type-changing transforms that differ ONLY in whether the schema's input
// side accepts the schema's own output. `refusing` rejects a candidate built
// from its own output; `overlapping` takes it back. The pair separates two
// outcomes that look alike from outside: one lands in D1's destructive
// replacement, the other writes normally.
const refusing = defineResource({
  scope: "session",
  ref: "refusing",
  stateSchema: z.object({
    n: z.string().default("0").transform(Number),
    keep: z.string().default("schema-default")
  }),
  default: { n: "0", keep: "schema-default" } as never
});

const overlapping = defineResource({
  scope: "session",
  ref: "overlapping",
  stateSchema: z.object({
    n: z.union([z.number(), z.string()]).default("0").transform(Number),
    keep: z.string().default("schema-default")
  }),
  default: { n: "0", keep: "schema-default" } as never
});

/**
 * A top-level `.catch()` around a closed object carrying an inner refinement —
 * ordinary defensive Zod, and the shape behind defect D2. `.catch()` means
 * `safeParse` NEVER fails, so an invalid candidate is not rejected: it comes
 * back as the fallback, and the normalizer stores that.
 */
const caught = defineResource({
  scope: "session",
  ref: "caught",
  stateSchema: z
    .object({
      n: z.number().nonnegative().default(0),
      keep: z.string().default("schema-default")
    })
    .catch({ n: 0, keep: "schema-default" }),
  default: { n: 0, keep: "schema-default" }
});

/**
 * A same-type transform that INTRODUCES a value the storage layer cannot
 * round-trip. Defect D4: the corruption originates inside the schema, after any
 * check a caller could perform on its own argument.
 */
const infinitizing = defineResource({
  scope: "session",
  ref: "infinitizing",
  stateSchema: z.object({
    n: z
      .number()
      .transform((v) => (v > 100 ? Infinity : v))
      .default(0),
    keep: z.string().default("schema-default")
  }),
  default: { n: 0, keep: "schema-default" }
});

/**
 * A schema with NO valid complete default: `required` has no default, so
 * neither `safeParse(undefined)` nor `safeParse({})` yields a complete object
 * and `normalizeResourceDefault` bottoms out at `{}`. This is the shape §9's
 * invalid-default row is about — a row that was READ rather than run, and was
 * wrong as a result.
 */
const noDefault = defineResource({
  scope: "session",
  ref: "noDefault",
  stateSchema: z.object({
    required: z.string(),
    n: z.number().default(0)
  })
});

function makeFlow() {
  return defineFlow({
    kind: "fix1154-poc",
    actions: {
      run: {
        inputSchema: z.string(),
        block: handler({
          name: "noop",
          resources: {
            counter,
            tasks,
            drifting,
            bag,
            refusing,
            overlapping,
            caught,
            infinitizing,
            noDefault
          },
          execute: () => "ok"
        })
      }
    }
  })();
}

/** One execution context over a shared store — i.e. one in-flight request. */
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

/**
 * Same, but wired to a real response emitter so `resource_change` items are
 * capturable. The `committed: false` invariant exists *because* the change
 * notification is gated on it, so comparing stored state and version only tests
 * half of it — these rows test the half that matters.
 */
async function makeCtxWithEmitter(stores: StoreRegistry, requestId: string) {
  const items: Array<{ type: string; [k: string]: unknown }> = [];
  const response = createInternalResponseEmitter({ requestId, internalSeams: undefined });
  response.subscribeToItems((item: { type: string }) => items.push(item as never));
  const ctx = await createExecutionContext({
    flow: makeFlow(),
    actionName: "run",
    requestId,
    sessionId: "sess_1",
    userId: "user_1",
    stores,
    response
  });
  // Deduped by item id: this emitter delivers each item to a subscriber more
  // than once (same `id`, same `itemIndex`), which is a property of the test
  // harness and not of the write path — it happens identically for the existing
  // `patchState`. Counting distinct change items is what these rows are about.
  const changes = (): string[] => [
    ...new Set(
      items.filter((i) => i.type === "resource_change").map((i) => i.id as string)
    )
  ];
  return { ctx, changes };
}

function readRow(stores: StoreRegistry, key: string) {
  return stores.resourceState.get("session", "sess_1", key);
}

// ---------------------------------------------------------------------------
// Incrementing and appending on a resource, the only way `main` allows: a
// mutator body handed to `updateState`, which reaches the same write path
// `patchState` uses. These are call-site shapes, not API — resources have no
// `incState` / `pushState` and are not getting them this cycle (D-6, #1446).
//
// `toNumber` / `toList` mirror `state-container.ts`'s bag-side coercions, so
// the shape being characterized here is the one a developer would write after
// reading the bag's docs.
// ---------------------------------------------------------------------------

type MutableRef = {
  updateState(updater: (s: PocState) => PocState | Promise<PocState>): Promise<void>;
};

const toNumber = (v: unknown): number => (typeof v === "number" ? v : 0);
const toList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function incrementVia(ref: MutableRef, increments: Record<string, number>): Promise<void> {
  return ref.updateState((s) => {
    const next = { ...s } as Record<string, unknown>;
    for (const [field, delta] of Object.entries(increments)) {
      next[field] = toNumber(next[field]) + delta;
    }
    return next as PocState;
  });
}

function appendVia(ref: MutableRef, field: string, value: unknown): Promise<void> {
  return ref.updateState((s) => {
    const next = { ...s } as Record<string, unknown>;
    next[field] = [...toList(next[field]), value];
    return next as PocState;
  });
}

// ---------------------------------------------------------------------------

describe("FIX-1154 POC — the policy rows under increment/append mutators", () => {
  it("row: ordinary conflict — two contexts incrementing one counter both land", async () => {
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    const ctxB = await makeCtx(stores, "req_b");

    // Materialize the row first, so this exercises the plain retry row rather
    // than the create-if-absent one below.
    await incrementVia(ctxA.resources.counter as unknown as MutableRef, { n: 1 });

    const ctxC = await makeCtx(stores, "req_c");
    await Promise.all([
      incrementVia(ctxB.resources.counter as unknown as MutableRef, { n: 1 }),
      incrementVia(ctxC.resources.counter as unknown as MutableRef, { n: 1 })
    ]);

    // Neither increment is lost: the loser re-ran its mutator against the
    // winner's state. This is what map row 10's resource half rests on.
    expect((await readRow(stores, "counter"))?.state).toMatchObject({ n: 3 });
  });

  it("row: ordinary conflict — two contexts appending to one array both land", async () => {
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    await appendVia(ctxA.resources.counter as unknown as MutableRef, "log", "seed");

    const ctxB = await makeCtx(stores, "req_b");
    const ctxC = await makeCtx(stores, "req_c");
    await Promise.all([
      appendVia(ctxB.resources.counter as unknown as MutableRef, "log", "b"),
      appendVia(ctxC.resources.counter as unknown as MutableRef, "log", "c")
    ]);

    const log = ((await readRow(stores, "counter"))?.state as PocState).log as string[];
    expect(log).toHaveLength(3);
    expect(new Set(log)).toEqual(new Set(["seed", "b", "c"]));
  });

  it("row: conflict against a tombstone is TERMINAL and FAILS FAST", async () => {
    // What this row proves is the *shape* of the failure, not that a write was
    // prevented. A positive held version requires a LIVE row at that version
    // (`resource-state-predicate.ts:145-156`), so the write could not land under
    // either driver. The shared driver would re-present the same positive
    // version each retry and exhaust into a generic ConcurrentModificationError;
    // this driver reports the deletion immediately and precisely. (Resurrection
    // is real only at version 0 — the FIX-1258 row below.)
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    await (ctxA.resources.tasks as any).create("t1", { n: 1 });

    // B holds t1; A deletes it; B then increments what it still holds.
    const ctxB = await makeCtx(stores, "req_b");
    const instance = await (ctxB.resources.tasks as any).get("t1");
    await (ctxA.resources.tasks as any).delete("t1");

    await expect(incrementVia(instance, { n: 1 })).rejects.toBeInstanceOf(ResourceDeletedError);
    expect((await readRow(stores, "tasks/t1"))?.state).toBeUndefined();
  });

  it("row: append against a tombstone is TERMINAL and fails fast too", async () => {
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    await (ctxA.resources.tasks as any).create("t1", { log: [] });

    const ctxB = await makeCtx(stores, "req_b");
    const instance = await (ctxB.resources.tasks as any).get("t1");
    await (ctxA.resources.tasks as any).delete("t1");

    await expect(appendVia(instance, "log", "x")).rejects.toBeInstanceOf(ResourceDeletedError);
    expect((await readRow(stores, "tasks/t1"))?.state).toBeUndefined();
  });

  it("row: verified no-op — a zero increment neither bumps the version nor emits", async () => {
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    await incrementVia(ctx.resources.counter as unknown as MutableRef, { n: 5 });
    const before = await readRow(stores, "counter");

    await incrementVia(ctx.resources.counter as unknown as MutableRef, { n: 0 });
    const after = await readRow(stores, "counter");

    // Suppression is only correct because the driver re-read and confirmed the
    // version. Same invariant the `resource_change` gate rests on.
    expect(after?.version).toBe(before?.version);
    expect(after?.state).toMatchObject({ n: 5 });
  });

  it("row: never-persisted key — a no-op increment is NOT reported as a deletion", async () => {
    // The regression the driver header calls out: a declared resource living
    // on its schema default, touched for the first time with a mutation that
    // changes nothing.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");

    await expect(
      incrementVia(ctx.resources.counter as unknown as MutableRef, { n: 0 })
    ).resolves.toBeUndefined();

    // Nothing written, nothing claimed deleted.
    expect((await readRow(stores, "counter"))?.state).toBeUndefined();
  });

  it("row: verified no-op emits NO resource_change — live single handle", async () => {
    const stores = createInMemoryStores();
    const { ctx, changes } = await makeCtxWithEmitter(stores, "req_a");
    const ref = ctx.resources.counter as unknown as MutableRef;

    // Negative control FIRST. If the emitter were not wired, or this resource
    // were not live, every assertion below would pass for the wrong reason.
    await incrementVia(ref, { n: 5 });
    expect(changes()).toHaveLength(1);

    await incrementVia(ref, { n: 0 });
    expect(changes()).toHaveLength(1); // still 1 — the no-op notified nothing
  });

  it("row: verified no-op emits NO resource_change — collection-instance handle", async () => {
    // The second ref builder. The two handles duplicate their write ops, and a
    // collection notifies UNCONDITIONALLY on commit (no live/reactTo gate), so
    // a no-op that wrongly reported `committed: true` would be visible here and
    // invisible on a non-live single.
    const stores = createInMemoryStores();
    const { ctx, changes } = await makeCtxWithEmitter(stores, "req_a");
    await (ctx.resources.tasks as any).create("t1", { n: 0 });
    const instance = await (ctx.resources.tasks as any).get("t1");

    const afterCreate = changes().length;
    await incrementVia(instance, { n: 3 });
    expect(changes().length).toBe(afterCreate + 1); // negative control

    await incrementVia(instance, { n: 0 });
    expect(changes().length).toBe(afterCreate + 1); // no-op stayed silent
  });

  it("row: a NO-OP against a row we held and lost is TERMINAL, not a quiet no-op", async () => {
    // The combined case: a stale POSITIVE version + a deleted row + a mutation
    // that changes nothing. The no-op branch re-reads, finds no live row, and
    // because the held version is not 0 it reports the deletion rather than
    // returning committed:false. This is the boundary of the "a no-op is never
    // reported as a deletion" guarantee — that only holds for a live row or a
    // never-stored one.
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    await (ctxA.resources.tasks as any).create("t1", { n: 5 });

    const ctxB = await makeCtx(stores, "req_b");
    const instance = await (ctxB.resources.tasks as any).get("t1");
    await (ctxA.resources.tasks as any).delete("t1");

    // B's increment computes {n:5} — identical to what B holds — so it takes
    // the no-op path, not the persist path.
    await expect(incrementVia(instance, { n: 0 })).rejects.toBeInstanceOf(ResourceDeletedError);
  });

  it("CURRENT BEHAVIOUR (defect D5): a version-0 context REVIVES a tombstone", async () => {
    // This row asserts what the shipped driver does TODAY, not what it should
    // do. A live defect, reachable through shipped APIs with no new verb
    // involved: `updateState` does exactly this on `main`.
    //
    // FIX-1154 documents it and does not fix it. **This row will fail when the
    // fix lands, and that failure is the intended signal.** Provenance:
    // FIX-1258.
    const stores = createInMemoryStores();
    // B's context exists BEFORE the key is ever written, so it holds container
    // version 0 for "counter" — it never observed a live row.
    const ctxB = await makeCtx(stores, "req_b");
    const ctxA = await makeCtx(stores, "req_a");

    await incrementVia(ctxA.resources.counter as unknown as MutableRef, { n: 5 });
    expect((await readRow(stores, "counter"))?.state).toMatchObject({ n: 5 });

    // Tombstone it through the store — the same call the session-delete route
    // makes via `deleteAll` (`routes/session-routes.ts:228-229`), and the same
    // one collection eviction and `collection.delete()` reach per key.
    await stores.resourceState.delete("session", "sess_1", "counter", "any");
    expect(await readRow(stores, "counter")).toBeUndefined();

    // B now makes a real change, writing at expectedVersion 0 — create-if-absent,
    // which a tombstone satisfies (`resource-state-predicate.ts:147-149`).
    await incrementVia(ctxB.resources.counter as unknown as MutableRef, { n: 1 });

    // The deleted resource is live again, holding B's default-derived value.
    // A's data is gone and the delete has been undone, with no error raised.
    expect((await readRow(stores, "counter"))?.state).toMatchObject({ n: 1 });
  });

  it("row: never-persisted key — a real increment creates it at create-if-absent", async () => {
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");

    await incrementVia(ctx.resources.counter as unknown as MutableRef, { n: 1 });
    expect((await readRow(stores, "counter"))?.state).toMatchObject({ n: 1 });
  });

  it("row: two first-touch increments race — they CONVERGE, they do not raise already-exists", async () => {
    // The one row where an increment-shaped mutator could plausibly have
    // differed from `patchState`. A first touch writes at `expectedVersion: 0`, which IS
    // create-if-absent — but under `intent: "mutate"`, so the loser refreshes
    // and re-runs rather than going terminal the way an explicit `create` does.
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    const ctxB = await makeCtx(stores, "req_b");

    await Promise.all([
      incrementVia(ctxA.resources.counter as unknown as MutableRef, { n: 1 }),
      incrementVia(ctxB.resources.counter as unknown as MutableRef, { n: 1 })
    ]);

    expect((await readRow(stores, "counter"))?.state).toMatchObject({ n: 2 });
  });

  it("CURRENT BEHAVIOUR (defect D3): a same-type transform DRIFTS the stored value", async () => {
    // Like the tombstone row above, this asserts what `main` does TODAY.
    //
    // `normalizeResourceState` stores the OUTPUT of `safeParse` rather than the
    // candidate it validated, and both ends of a read-modify-write cycle run it
    // (`resource-registry.ts:209` on load, `:664` on write). The schema's output
    // type IS its input type, so nothing stated over the handle's type could
    // exclude this.
    //
    // The fix belongs to the shared normalizer, where it lands once for every
    // mutator. **This row fails when that lands, and the failure is the intended
    // signal.** Provenance: FIX-1260.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = ctx.resources.drifting as unknown as MutableRef;

    // An IDENTITY mutator — no arithmetic from any verb, framework or caller.
    // If the value still moves, the drift is the normalizer's alone.
    await ref.updateState((s) => ({ ...s }));
    const first = (await readRow(stores, "drifting"))?.state as { n: number };

    await ref.updateState((s) => ({ ...s }));
    const second = (await readRow(stores, "drifting"))?.state as { n: number };

    expect(second.n).toBe(first.n + 1);

    // And through an increment-shaped mutator, where a caller asking for +1
    // gets +2 and the call resolves successfully.
    const before = (await readRow(stores, "drifting"))?.state as { n: number };
    await incrementVia(ref, { n: 1 });
    const after = (await readRow(stores, "drifting"))?.state as { n: number };
    expect(after.n).toBe(before.n + 2);
  });

  it("CURRENT BEHAVIOUR (defect D2): a .catch() schema SWALLOWS the failure and stores the fallback", async () => {
    // Strictly worse than D1 and not the same defect. D1 needs the schema to
    // REJECT the candidate; `.catch()` means `safeParse` never fails at all, so
    // there is no rejection anywhere in this path. An inner refinement violation
    // comes back as the catch fallback, `normalizeResourceState` stores that,
    // and the whole row is replaced with no error raised.
    //
    // `.catch()` is ordinary defensive Zod — the point of the row is that the
    // shape is unremarkable.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = ctx.resources.caught as unknown as MutableRef;

    await ref.updateState(() => ({ n: 5, keep: "DO-NOT-LOSE" }));
    expect((await readRow(stores, "caught"))?.state).toMatchObject({
      n: 5,
      keep: "DO-NOT-LOSE"
    });

    // Violates the INNER `nonnegative()` refinement. Nothing throws.
    await ref.updateState((s) => ({ ...s, n: (s.n as number) - 99 }));

    const row = await readRow(stores, "caught");
    // The untouched field is gone, and the version advanced — a successful write
    // that erased live data.
    expect(row?.state).toMatchObject({ n: 0, keep: "schema-default" });
    expect(row?.version).toBe(2);
  });

  it("CURRENT BEHAVIOUR (defect D4): a transform can INTRODUCE a value the adapters disagree on", async () => {
    // The round-trip hazard reached from inside the schema rather than from the
    // caller's argument, which is what makes it un-guardable at the call site:
    // every value the caller supplied here is an ordinary finite number.
    //
    // The memory store keeps `Infinity` (it clones with `structuredClone`); a
    // JSON-backed adapter stores `null`, which then fails the schema on the next
    // durable read and lands in D1's replacement. Nothing throws on either side,
    // so the two deployments simply hold different data from the same call.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = ctx.resources.infinitizing as unknown as MutableRef;

    await ref.updateState(() => ({ n: 500, keep: "DO-NOT-LOSE" }));

    const state = (await readRow(stores, "infinitizing"))?.state as {
      n: number;
      keep: string;
    };
    // Memory: the transform's output, stored intact.
    expect(state.n).toBe(Infinity);
    expect(state.keep).toBe("DO-NOT-LOSE");

    // Every JSON-backed adapter: the same state, flattened.
    expect(JSON.parse(JSON.stringify(state))).toEqual({
      n: null,
      keep: "DO-NOT-LOSE"
    });
  });

  it("row: a transform loses the row only when its input side rejects its own output", async () => {
    // The row that separates the CONDITION from the UNIVERSAL. An earlier draft
    // of the spec generalized this to "every call on a transforming schema
    // refuses", which is false, and it had propagated into the published docs
    // brief before anyone read it against the heading it sat under ("output
    // re-parses as input").
    //
    // Both schemas below are type-changing and both expose `n: number`, so from
    // outside they are indistinguishable. What differs is whether a candidate
    // built from the schema's own output survives a trip back through its INPUT
    // side — and only that decides whether the row survives.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");

    // 1. Input wants a string. The candidate `{n: 1}` does not re-parse, and
    //    the write path's response to an invalid candidate is to replace the
    //    whole state with the schema default — defect D1, reached through an
    //    ordinary normalizing schema. Assert the STATE, not an absence of throw:
    //    nothing throws here either way.
    const refusingRef = ctx.resources.refusing as unknown as MutableRef;
    await refusingRef.updateState((s) => ({ ...s, keep: "DO-NOT-LOSE" }));
    await incrementVia(refusingRef, { n: 1 });
    const afterRefusing = (await readRow(stores, "refusing"))?.state as {
      n: number;
      keep: string;
    };
    // `keep` was live data. It is gone, and the call reported success.
    expect(afterRefusing.keep).toBe("schema-default");

    // 2. Input accepts a number OR a string. The same candidate re-parses, so
    //    the write lands and the row is intact. The negative control: the
    //    hazard is re-parse rejection, not "the schema transforms".
    const overlappingRef = ctx.resources.overlapping as unknown as MutableRef;
    await overlappingRef.updateState((s) => ({ ...s, keep: "DO-NOT-LOSE" }));
    await incrementVia(overlappingRef, { n: 1 });
    const afterOverlapping = (await readRow(stores, "overlapping"))?.state as {
      n: number;
      keep: string;
    };
    expect(afterOverlapping.n).toBe(1);
    expect(afterOverlapping.keep).toBe("DO-NOT-LOSE");
  });

  // -------------------------------------------------------------------------
  // THE DATA-LOSS ROWS.
  //
  // Everything above characterizes the CAS driver. These four characterize what
  // the write path does with values the schema ACCEPTS but the storage layer
  // cannot carry — §7c's hazard class. They exist because prose kept getting
  // the boundary wrong, each round enumerating the kinds known at the time.
  // Each pins what `main` does TODAY.
  // -------------------------------------------------------------------------

  it("data loss: BRANDED OBJECTS survive z.array(z.any()) and then split by adapter", async () => {
    // The case no kind-based check sees. `undefined`, functions, symbols and
    // bigints all announce themselves to a `typeof` test; a Date does not. It
    // is an object with no enumerable own properties, so a guard walking
    // enumerable properties — the obvious implementation — finds nothing wrong
    // with any of these four and passes them straight through.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = ctx.resources.bag as unknown as MutableRef;

    await appendVia(ref, "items", new Date("2020-01-01T00:00:00.000Z"));
    await appendVia(ref, "items", new Map([["a", 1]]));
    await appendVia(ref, "items", new Set([1, 2]));
    await appendVia(ref, "items", /abc/g);

    const items = ((await readRow(stores, "bag"))?.state as PocState).items as unknown[];

    // 1. The schema accepted all four. Nothing on this path rejects them.
    expect(items).toHaveLength(4);

    // 2. The MEMORY store preserved them as live instances, because
    //    `cloneValue` prefers `structuredClone` (`core/src/helpers/clone.ts:16`),
    //    which round-trips all four of these types intact.
    expect(items.map((v) => Object.prototype.toString.call(v))).toEqual([
      "[object Date]",
      "[object Map]",
      "[object Set]",
      "[object RegExp]"
    ]);

    // 3. A JSON-backed adapter stores something DIFFERENT for the same write:
    //    the Date flattens to a string, and Map/Set/RegExp flatten to `{}` —
    //    losing their contents outright. Two adapters, two stored values, one
    //    caller. That divergence is why §7c states the hazard as "survives a
    //    JSON round-trip unchanged" rather than as a list of forbidden kinds:
    //    a Date is perfectly JSON-safe and still stores differently.
    const flattened = JSON.parse(JSON.stringify(items));
    expect(flattened).toEqual([
      "2020-01-01T00:00:00.000Z",
      {},
      {},
      {}
    ]);

    // 4. And the flattened form STILL PARSES on the next durable read, so this
    //    row does NOT reach D1. Under `z.array(z.any())` a string and three
    //    `{}` are all accepted, which means nothing is rejected, nothing is
    //    replaced, and no error is raised at any point — the loss is silent and
    //    permanent rather than loud. Round 18 corrected §7c here: D1's
    //    replacement needs a schema that REFUSES the serialized form (an
    //    `Infinity` under `z.number()` does; these four do not), so a
    //    round-trip hazard must not be routed into D1 by default.
    const reread = bag.stateSchema.safeParse({ n: 0, keep: "k", items: flattened });
    expect(reread.success).toBe(true);
  });

  it("data loss: a BIGINT or SYMBOL delta throws a RETRYABLE raw TypeError", async () => {
    // `current + delta` runs before anything validates `delta`. For these two
    // the arithmetic itself throws, and it throws the wrong TYPE: a raw
    // TypeError is not a FlowError, so `isRetryableError` returns true for it
    // under any policy — the block re-runs, replaying every side effect it
    // already performed. Documenting an error as fatal does not survive this;
    // only the error's type does, which is the mechanism behind D6.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = ctx.resources.bag as unknown as MutableRef;
    const policy = { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 };

    for (const delta of [1n, Symbol("nope")]) {
      const caught = await incrementVia(ref, { n: delta } as never).then(
        () => undefined,
        (e: unknown) => e
      );

      expect(caught).toBeInstanceOf(TypeError);
      expect(caught).not.toBeInstanceOf(FlowError);
      // The assertion that matters: the retry layer WILL re-run this.
      expect(isRetryableError(caught as Error, policy)).toBe(true);
    }

    // Nothing was written — the throw happens in the mutator, before persist.
    expect((await readRow(stores, "bag"))?.state).toBeUndefined();
  });

  it("data loss: a STRING delta does not throw at all — it RESETS THE ROW and reports success", async () => {
    // The worst row in this file, and the one that shows why the delta has to
    // be validated BEFORE the arithmetic rather than caught after it.
    //
    // `0 + "5"` does not throw; it concatenates. The candidate `{n:"05"}` then
    // fails the schema, and the write path's response to an invalid candidate
    // is to REPLACE THE WHOLE STATE WITH THE SCHEMA DEFAULT — silently, and
    // successfully. An unrelated field holding real data is collateral.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = ctx.resources.bag as unknown as MutableRef;

    await incrementVia(ref, { n: 5 });
    await ref.updateState((s) => ({ ...s, keep: "DO-NOT-LOSE" }));

    const before = await readRow(stores, "bag");
    expect(before?.state).toMatchObject({ n: 5, keep: "DO-NOT-LOSE" });

    // No rejection. The call resolves.
    await expect(incrementVia(ref, { n: "5" } as never)).resolves.toBeUndefined();

    const after = await readRow(stores, "bag");
    // The counter is back to its default AND the untouched field is destroyed.
    expect(after?.state).toMatchObject({ n: 0, keep: "schema-default" });
    // ...and the version advanced, so this was a real write, not a no-op.
    expect(after?.version).toBeGreaterThan(before?.version as number);
  });

  it("row 5: a field the callback OMITS comes back at its schema DEFAULT, not absent", async () => {
    // Map row 5 said omitted fields are "gone". They are not absent — the
    // whole returned object is re-parsed by `normalizeResourceState`
    // (`resource-registry.ts:664`), so Zod REINTRODUCES a defaulted field at
    // its default, replacing the live value with something that looks
    // deliberate. That is a harder failure to notice than a hole, which is why
    // the row now says so.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_omit");
    const ref = ctx.resources.counter as unknown as MutableRef;

    await ref.updateState(() => ({ n: 5, log: ["DO-NOT-LOSE"] }));
    expect((await readRow(stores, "counter"))?.state).toEqual({
      n: 5,
      log: ["DO-NOT-LOSE"]
    });

    // The callback returns ONLY `n`. `log` is never mentioned.
    await ref.updateState((s) => ({ n: toNumber(s.n) + 1 }));

    // Not `{ n: 6 }` — `log` is back, emptied.
    expect((await readRow(stores, "counter"))?.state).toEqual({ n: 6, log: [] });
  });

  it("row: a first touch on a schema with NO valid complete default is a NO-OP, not a throw", async () => {
    // §9 asserted this row THROWS and landed it in D1. Both halves were wrong,
    // and the second contradicted D1 itself (which never throws). Nothing on
    // this path throws: `normalizeResourceState` falls back to
    // `normalizeResourceDefault`, that bottoms out at `{}`, and `{}` equals the
    // `{}` the write started from — so the driver verifies a no-op and writes
    // nothing at all. The failure mode is silence, not an error.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_nodefault");
    const ref = ctx.resources.noDefault as unknown as MutableRef;

    await expect(
      ref.updateState((s) => ({ ...s, n: toNumber(s.n) + 1 }))
    ).resolves.toBeUndefined();

    // No row was created. No version. No error anyone could act on.
    expect(await readRow(stores, "noDefault")).toBeUndefined();

    // The boundary: an updater that DOES supply every required field is
    // ordinary and succeeds — so the absence above is about the candidate, not
    // about the resource being unwritable.
    await ref.updateState(() => ({ required: "present", n: 1 }));
    const row = await readRow(stores, "noDefault");
    expect(row?.state).toEqual({ required: "present", n: 1 });
    expect(row?.version).toBe(1);
  });

  it("control: a plain Error is retryable too — which is why D6 is a defect", async () => {
    // The negative control for the two rows above, and D6's mechanism. It pins
    // the classifier's default: a refusal thrown as `new Error(...)` satisfies
    // every test that only asserts rejection, and is then retried anyway. Both
    // read-only refusals on `main` are exactly that shape.
    const policy = { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 };

    expect(isRetryableError(new Error("bad delta"), policy)).toBe(true);
    expect(isRetryableError(new TypeError("bad delta"), policy)).toBe(true);

    // Only a FlowError carrying `retryable: false` aborts the loop.
    expect(
      isRetryableError(
        new FlowError("bad delta", { code: "validation_error", retryable: false }),
        policy
      )
    ).toBe(false);
  });
});
