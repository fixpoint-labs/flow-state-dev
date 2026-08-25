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
 * same way; the spec drops that tier (§6 decision 2) precisely because nothing
 * here would carry over to it.
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

/** Local stand-in for the framework's `JsonObject` — the POC never leaves this file. */
type PocState = Record<string, unknown>;

const counter = defineResource({
  scope: "session",
  ref: "counter",
  stateSchema: z.object({
    n: z.number().default(0),
    log: z.array(z.string()).default([])
  }),
  default: { n: 0, log: [] }
});

const tasks = defineResourceCollection({
  scope: "session",
  pattern: "tasks/**",
  stateSchema: z.object({}).passthrough()
});

function makeFlow() {
  return defineFlow({
    kind: "fix1154-poc",
    actions: {
      run: {
        inputSchema: z.string(),
        block: handler({
          name: "noop",
          resources: { counter, tasks },
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

  it("row: conflict against a tombstone stays TERMINAL — no resurrection", async () => {
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

  it("row: append against a tombstone stays TERMINAL too", async () => {
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
});
