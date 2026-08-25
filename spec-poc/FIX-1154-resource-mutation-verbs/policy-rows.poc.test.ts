/**
 * FIX-1154 — characterization POC. Throwaway; never merges.
 *
 * THE QUESTION
 * The epic (FIX-1157, theme 2) marks one claim as its most load-bearing and
 * least evidenced: that every row of `resource-cas.ts`'s eight-row conflict
 * policy survives when resources grow increment and append verbs. It has only
 * ever been read off the types. This file runs it.
 *
 * WHAT IS BEING MODELLED, AND WHERE THE MODEL STOPS
 * The proposed `incState` / `pushState` are registry ops that hand a mutator to
 * `persistResourceState` — exactly as `patchState` hands it a merge. From
 * outside the registry the faithful stand-in for that is the ref's own
 * `updateState`: same per-key write queue, same `mutateResourceKey`, same
 * `runResourceCAS` under `intent: "mutate"`, same schema normalization. The only
 * difference between this stand-in and the real op is who authors the mutator
 * body — the framework instead of the caller — which is not a difference the
 * driver can see.
 *
 * So this POC is evidence about the DRIVER under increment/append-shaped
 * mutators. It is not evidence that a store-native delta verb would behave the
 * same way; the spec DEFERS that tier (§6 decision 2, settled at D-6) precisely
 * because nothing here would carry over to it.
 *
 * THE SECOND QUESTION (added round 13)
 * The last four rows are not about the driver. They pin the REFUSAL HAZARDS —
 * the values §7 says the two verbs must reject. They characterize the gap
 * rather than the guard, because the guard does not exist yet: each row asserts
 * what `main` does today, so it states what the shipped refusal has to stop.
 * They were added because three review rounds in a row corrected these rules in
 * prose, each time enumerating the value kinds known at the time and each time
 * missing a neighbour. Running them is cheaper than arguing them.
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
  // CLOSED, not `.passthrough()`. The verbs are specified for reflectable
  // object schemas (§7), and an open schema cannot recover a key's type or tell
  // a typo from a dynamic key. A fixture that used passthrough would be
  // demonstrating on a shape the spec does not support.
  stateSchema: z.object({
    n: z.number().default(0),
    log: z.array(z.string()).default([])
  })
});

/**
 * A SAME-TYPE transform: output type === input type, so this schema SATISFIES
 * both availability conditions in §7 and the verbs are offered on it. It still
 * drifts, because the drift is not an availability property — see the FIX-1260
 * row below.
 */
/**
 * A resource whose array field is `z.array(z.any())` and which carries a
 * SECOND, unrelated field. Both matter:
 *
 *  - `z.any()` is what the spec's §7 append rule is written against — it is the
 *    schema that accepts every hazardous value, so a narrower one would prove
 *    nothing about the guard.
 *  - `keep` is the untouched-field control. The failure these rows guard is not
 *    a bad value being stored; it is the WHOLE STATE being reset while the call
 *    reports success, and only an unrelated field can show that.
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

const drifting = defineResource({
  scope: "session",
  ref: "drifting",
  stateSchema: z.object({
    n: z.number().default(0).transform((v) => v + 1)
  }),
  default: { n: 0 }
});

function makeFlow() {
  return defineFlow({
    kind: "fix1154-poc",
    actions: {
      run: {
        inputSchema: z.string(),
        block: handler({
          name: "noop",
          resources: { counter, tasks, drifting, bag },
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
// The two proposed verbs, as the registry would implement them: a mutator body
// handed to the same write path `patchState` already uses. `toNumber` / `toList`
// mirror `state-container.ts`'s `incState` / `pushState` coercions so the two
// primitives agree on what a missing or wrong-typed field means.
// ---------------------------------------------------------------------------

type MutableRef = {
  updateState(updater: (s: PocState) => PocState | Promise<PocState>): Promise<void>;
};

const toNumber = (v: unknown): number => (typeof v === "number" ? v : 0);
const toList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function incState(ref: MutableRef, increments: Record<string, number>): Promise<void> {
  return ref.updateState((s) => {
    const next = { ...s } as Record<string, unknown>;
    for (const [field, delta] of Object.entries(increments)) {
      next[field] = toNumber(next[field]) + delta;
    }
    return next as PocState;
  });
}

function pushState(ref: MutableRef, field: string, value: unknown): Promise<void> {
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
    await incState(ctxA.resources.counter as unknown as MutableRef, { n: 1 });

    const ctxC = await makeCtx(stores, "req_c");
    await Promise.all([
      incState(ctxB.resources.counter as unknown as MutableRef, { n: 1 }),
      incState(ctxC.resources.counter as unknown as MutableRef, { n: 1 })
    ]);

    // Neither increment is lost: the loser re-ran its mutator against the
    // winner's state. This is the claim the verbs exist to make good on.
    expect((await readRow(stores, "counter"))?.state).toMatchObject({ n: 3 });
  });

  it("row: ordinary conflict — two contexts appending to one array both land", async () => {
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    await pushState(ctxA.resources.counter as unknown as MutableRef, "log", "seed");

    const ctxB = await makeCtx(stores, "req_b");
    const ctxC = await makeCtx(stores, "req_c");
    await Promise.all([
      pushState(ctxB.resources.counter as unknown as MutableRef, "log", "b"),
      pushState(ctxC.resources.counter as unknown as MutableRef, "log", "c")
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

    await expect(incState(instance, { n: 1 })).rejects.toBeInstanceOf(ResourceDeletedError);
    expect((await readRow(stores, "tasks/t1"))?.state).toBeUndefined();
  });

  it("row: append against a tombstone is TERMINAL and fails fast too", async () => {
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    await (ctxA.resources.tasks as any).create("t1", { log: [] });

    const ctxB = await makeCtx(stores, "req_b");
    const instance = await (ctxB.resources.tasks as any).get("t1");
    await (ctxA.resources.tasks as any).delete("t1");

    await expect(pushState(instance, "log", "x")).rejects.toBeInstanceOf(ResourceDeletedError);
    expect((await readRow(stores, "tasks/t1"))?.state).toBeUndefined();
  });

  it("row: verified no-op — a zero increment neither bumps the version nor emits", async () => {
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    await incState(ctx.resources.counter as unknown as MutableRef, { n: 5 });
    const before = await readRow(stores, "counter");

    await incState(ctx.resources.counter as unknown as MutableRef, { n: 0 });
    const after = await readRow(stores, "counter");

    // Suppression is only correct because the driver re-read and confirmed the
    // version. Same invariant the `resource_change` gate rests on.
    expect(after?.version).toBe(before?.version);
    expect(after?.state).toMatchObject({ n: 5 });
  });

  it("row: never-persisted key — a no-op increment is NOT reported as a deletion", async () => {
    // The regression the driver header calls out, now reached through the new
    // verb: a declared resource living on its schema default, touched for the
    // first time with a mutation that changes nothing.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");

    await expect(
      incState(ctx.resources.counter as unknown as MutableRef, { n: 0 })
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
    await incState(ref, { n: 5 });
    expect(changes()).toHaveLength(1);

    await incState(ref, { n: 0 });
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
    await incState(instance, { n: 3 });
    expect(changes().length).toBe(afterCreate + 1); // negative control

    await incState(instance, { n: 0 });
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
    await expect(incState(instance, { n: 0 })).rejects.toBeInstanceOf(ResourceDeletedError);
  });

  it("CURRENT BEHAVIOUR (defect, FIX-1258): a version-0 context REVIVES a tombstone", async () => {
    // This row asserts what the shipped driver does TODAY, not what it should
    // do. It is a live defect — reachable through shipped APIs, and NOT caused
    // by the two new verbs: `updateState` does exactly this on `main`.
    //
    // FIX-1154 deliberately does not fix it; FIX-1258 owns it. **This row will
    // fail when FIX-1258 lands, and that failure is the intended signal.**
    const stores = createInMemoryStores();
    // B's context exists BEFORE the key is ever written, so it holds container
    // version 0 for "counter" — it never observed a live row.
    const ctxB = await makeCtx(stores, "req_b");
    const ctxA = await makeCtx(stores, "req_a");

    await incState(ctxA.resources.counter as unknown as MutableRef, { n: 5 });
    expect((await readRow(stores, "counter"))?.state).toMatchObject({ n: 5 });

    // Tombstone it through the store — the same call the session-delete route
    // makes via `deleteAll` (`routes/session-routes.ts:228-229`), and the same
    // one collection eviction and `collection.delete()` reach per key.
    await stores.resourceState.delete("session", "sess_1", "counter", "any");
    expect(await readRow(stores, "counter")).toBeUndefined();

    // B now makes a real change, writing at expectedVersion 0 — create-if-absent,
    // which a tombstone satisfies (`resource-state-predicate.ts:147-149`).
    await incState(ctxB.resources.counter as unknown as MutableRef, { n: 1 });

    // The deleted resource is live again, holding B's default-derived value.
    // A's data is gone and the delete has been undone, with no error raised.
    expect((await readRow(stores, "counter"))?.state).toMatchObject({ n: 1 });
  });

  it("row: never-persisted key — a real increment creates it at create-if-absent", async () => {
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");

    await incState(ctx.resources.counter as unknown as MutableRef, { n: 1 });
    expect((await readRow(stores, "counter"))?.state).toMatchObject({ n: 1 });
  });

  it("row: two first-touch increments race — they CONVERGE, they do not raise already-exists", async () => {
    // The one row where the new verbs could plausibly have differed from
    // `patchState`. A first touch writes at `expectedVersion: 0`, which IS
    // create-if-absent — but under `intent: "mutate"`, so the loser refreshes
    // and re-runs rather than going terminal the way an explicit `create` does.
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    const ctxB = await makeCtx(stores, "req_b");

    await Promise.all([
      incState(ctxA.resources.counter as unknown as MutableRef, { n: 1 }),
      incState(ctxB.resources.counter as unknown as MutableRef, { n: 1 })
    ]);

    expect((await readRow(stores, "counter"))?.state).toMatchObject({ n: 2 });
  });

  it("CURRENT BEHAVIOUR (defect, FIX-1260): a same-type transform DRIFTS the stored value", async () => {
    // Like the FIX-1258 row above, this asserts what `main` does TODAY.
    //
    // The schema satisfies both §7 availability conditions — no string index
    // signature, and its output type IS its input type — so the verbs are
    // offered on it. It drifts anyway, because `normalizeResourceState` stores
    // the OUTPUT of `safeParse` rather than the candidate it validated, and both
    // ends of a read-modify-write cycle run it (`resource-registry.ts:209` on
    // load, `:664` on write).
    //
    // FIX-1154 deliberately does not fix it, and deliberately does NOT put a
    // guard behind the two new verbs: that would leave `updateState` /
    // `patchState` / `setState` corrupting through the same normalizer while the
    // new verbs looked safe — the per-verb asymmetry this epic exists to remove.
    // FIX-1260 owns it, in the shared normalizer. **This row fails when FIX-1260
    // lands, and that failure is the intended signal.**
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

    // And through the proposed verb, which inherits it rather than causing it:
    // a +1 lands as +2 and the call resolves successfully.
    const before = (await readRow(stores, "drifting"))?.state as { n: number };
    await incState(ref, { n: 1 });
    const after = (await readRow(stores, "drifting"))?.state as { n: number };
    expect(after.n).toBe(before.n + 2);
  });

  // -------------------------------------------------------------------------
  // THE REFUSAL ROWS.
  //
  // Everything above characterizes the CAS driver. These four characterize the
  // hazards the two verbs have to refuse — and they exist because prose kept
  // getting them wrong. Each pins what `main` does TODAY, so each states the
  // gap the shipped guard has to close rather than the guard's own behaviour.
  // -------------------------------------------------------------------------

  it("refusal gap: BRANDED OBJECTS survive z.array(z.any()) and then split by adapter", async () => {
    // The case no kind-based check sees. `undefined`, functions, symbols and
    // bigints all announce themselves to a `typeof` test; a Date does not. It
    // is an object with no enumerable own properties, so a guard walking
    // enumerable properties — the obvious implementation — finds nothing wrong
    // with any of these four and passes them straight through.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = ctx.resources.bag as unknown as MutableRef;

    await pushState(ref, "items", new Date("2020-01-01T00:00:00.000Z"));
    await pushState(ref, "items", new Map([["a", 1]]));
    await pushState(ref, "items", new Set([1, 2]));
    await pushState(ref, "items", /abc/g);

    const items = ((await readRow(stores, "bag"))?.state as PocState).items as unknown[];

    // 1. The schema accepted all four. No refusal exists today.
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
    //    caller. That divergence is the whole reason the append rule exists,
    //    and it is why the rule is stated as "survives a JSON round-trip
    //    unchanged" rather than as a list of forbidden kinds.
    expect(JSON.parse(JSON.stringify(items))).toEqual([
      "2020-01-01T00:00:00.000Z",
      {},
      {},
      {}
    ]);
  });

  it("refusal gap: a BIGINT or SYMBOL delta throws a RETRYABLE raw TypeError", async () => {
    // `current + delta` runs before anything validates `delta`. For these two
    // the arithmetic itself throws, and it throws the wrong TYPE: a raw
    // TypeError is not a FlowError, so `isRetryableError` returns true for it
    // under any policy — the block re-runs, replaying every side effect it
    // already performed. "Documented as fatal" does not survive this; only the
    // error's type does.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = ctx.resources.bag as unknown as MutableRef;
    const policy = { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 };

    for (const delta of [1n, Symbol("nope")]) {
      const caught = await incState(ref, { n: delta } as never).then(
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

  it("refusal gap: a STRING delta does not throw at all — it RESETS THE ROW and reports success", async () => {
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

    await incState(ref, { n: 5 });
    await ref.updateState((s) => ({ ...s, keep: "DO-NOT-LOSE" }));

    const before = await readRow(stores, "bag");
    expect(before?.state).toMatchObject({ n: 5, keep: "DO-NOT-LOSE" });

    // No rejection. The call resolves.
    await expect(incState(ref, { n: "5" } as never)).resolves.toBeUndefined();

    const after = await readRow(stores, "bag");
    // The counter is back to its default AND the untouched field is destroyed.
    expect(after?.state).toMatchObject({ n: 0, keep: "schema-default" });
    // ...and the version advanced, so this was a real write, not a no-op.
    expect(after?.version).toBeGreaterThan(before?.version as number);
  });

  it("control: a plain Error is retryable too — which is why refusals need a TYPE", async () => {
    // The negative control for the two rows above. It is not about the verbs;
    // it pins the classifier's default, which is what makes every "throws"
    // instruction in the spec insufficient on its own. A refusal that throws
    // `new Error("bad delta")` satisfies every test that only asserts
    // rejection, and is then retried.
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
