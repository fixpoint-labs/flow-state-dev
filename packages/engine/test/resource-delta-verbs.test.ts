/**
 * FIX-1269 — `incState` / `pushState` on resource handles.
 *
 * Every case drives the REAL path: `createExecutionContext` over
 * `createInMemoryStores`, exactly as two concurrent HTTP requests in one Node
 * process do. The verbs are two more mutator bodies handed to the write path
 * resources already use, so what is under test is the mutator contract — not
 * the store, which is untouched.
 *
 * **Second path (BP-035).** The registry builds `ResourceRef`s in TWO separate
 * factories — the collection-instance factory and the single-resource handle —
 * so every behaviour runs on both. A suite covering only singles is the obvious
 * miss here: the verbs could be missing from one factory entirely and stay green.
 *
 * The schemas are `passthrough()` deliberately. A closed `z.array(...)` field
 * refuses a scalar at schema-parse time before any append can happen, so the
 * wrong-typed target this feature refuses is only *reachable* on a resource
 * whose schema permits more than one shape in a field.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import type { JsonObject, ResourceRef } from "@flow-state-dev/core/types";
import { createExecutionContext, createInMemoryStores, type StoreRegistry } from "../src";

const counter = defineResource({
  scope: "session",
  stateSchema: z.object({}).passthrough(),
  default: {}
});

const tallies = defineResourceCollection({
  scope: "session",
  pattern: "tallies/**",
  stateSchema: z.object({}).passthrough()
});

function makeFlow() {
  return defineFlow({
    kind: "fix1269-delta-verbs",
    actions: {
      run: {
        inputSchema: z.string(),
        block: handler({
          name: "noop",
          resources: { counter, tallies },
          execute: () => "ok"
        })
      }
    }
  })();
}

/**
 * One execution context over a shared store — i.e. one in-flight request. Each
 * call builds its own registry, caches and version map, so two of them are
 * genuinely two concurrent contexts rather than two handles on one.
 */
async function makeCtx(stores: StoreRegistry, requestId: string) {
  return createExecutionContext({
    flow: makeFlow(),
    actionName: "run",
    requestId,
    sessionId: "sess_1",
    userId: "user_1",
    stores
  });
}

async function readStored(
  stores: StoreRegistry,
  key: string
): Promise<JsonObject | undefined> {
  const row = await stores.resourceState.get("session", "sess_1", key);
  return row?.state;
}

async function readVersion(stores: StoreRegistry, key: string): Promise<number | undefined> {
  const row = await stores.resourceState.get("session", "sess_1", key);
  return row?.version;
}

const HANDLE_KINDS = ["single resource", "collection instance"] as const;
type HandleKind = (typeof HANDLE_KINDS)[number];

const keyFor = (kind: HandleKind): string =>
  kind === "single resource" ? "counter" : "tallies/t1";

/** Seed a handle with `initial` and return it. */
async function seedHandle(
  ctx: any,
  kind: HandleKind,
  initial: JsonObject
): Promise<ResourceRef<JsonObject>> {
  if (kind === "single resource") {
    // Skip the write for an empty seed, so the never-persisted first-touch case
    // stays reachable on this path.
    if (Object.keys(initial).length > 0) await ctx.resources.counter.setState(initial);
    return ctx.resources.counter as ResourceRef<JsonObject>;
  }
  await ctx.resources.tallies.create("t1", initial);
  return (await ctx.resources.tallies.get("t1")) as ResourceRef<JsonObject>;
}

/** Read an existing handle out of a (possibly stale) context cache. */
async function getHandle(ctx: any, kind: HandleKind): Promise<ResourceRef<JsonObject>> {
  return kind === "single resource"
    ? (ctx.resources.counter as ResourceRef<JsonObject>)
    : ((await ctx.resources.tallies.get("t1")) as ResourceRef<JsonObject>);
}

describe.each(HANDLE_KINDS)("FIX-1269 delta verbs on a %s", (kind) => {
  const key = keyFor(kind);

  it("incState adds to a counter and pushState appends to a list", async () => {
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = await seedHandle(ctx, kind, { calls: 2, errors: ["first"] });

    await ref.incState({ calls: 3 });
    await ref.pushState("errors", "rate_limited");

    expect(await readStored(stores, key)).toEqual({
      calls: 5,
      errors: ["first", "rate_limited"]
    });
  });

  it("two concurrent contexts incrementing one counter both land", async () => {
    // The headline claim (§2): each call is a single CAS-guarded mutation, so
    // the loser re-runs its mutator against the winner's row rather than
    // writing a value it computed from a snapshot that has since moved. Under a
    // read-then-write this lands on 1, not 2.
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    const refA = await seedHandle(ctxA, kind, { calls: 0 });

    const ctxB = await makeCtx(stores, "req_b");
    const refB = await getHandle(ctxB, kind);

    await Promise.all([refA.incState({ calls: 1 }), refB.incState({ calls: 1 })]);

    expect((await readStored(stores, key))!.calls).toBe(2);
  });

  it("incState refuses a non-number target and leaves the stored value intact", async () => {
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = await seedHandle(ctx, kind, { calls: "not-a-number" });
    const before = await readVersion(stores, key);

    // The message matches the bag's `pushToArray` family rather than inventing
    // a third shape, and names the field and the type found.
    await expect(ref.incState({ calls: 1 })).rejects.toThrow(
      /"calls" is not a number \(got string\)/
    );

    // The half that carries the weight: an implementation that threw AFTER
    // writing passes the assertion above and fails these. The version pins the
    // stronger claim — a refusal writes NOTHING, rather than rewriting the same
    // value and bumping the row past every other context's cached version.
    expect(await readStored(stores, key)).toEqual({ calls: "not-a-number" });
    expect(await readVersion(stores, key)).toBe(before);
  });

  it("pushState refuses a non-array target and leaves the stored value intact", async () => {
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = await seedHandle(ctx, kind, { errors: "not-an-array" });
    const before = await readVersion(stores, key);

    await expect(ref.pushState("errors", "boom")).rejects.toThrow(
      /"errors" is not an array \(got string\)/
    );

    expect(await readStored(stores, key)).toEqual({ errors: "not-an-array" });
    expect(await readVersion(stores, key)).toBe(before);
  });

  it("treats an absent or null field as first touch, not a wrong type", async () => {
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");

    // Absent — the case a naive type guard breaks.
    const ref = await seedHandle(ctx, kind, {});
    await ref.incState({ calls: 1 });
    await ref.pushState("errors", "first");
    expect(await readStored(stores, key)).toEqual({ calls: 1, errors: ["first"] });

    // Null — BP-023 declares state fields `.nullable().default(null)`, so an
    // untouched counter reads as `null` rather than absent. That is the field's
    // declared empty state, not a wrong kind of value.
    await ref.setState({ calls: null, errors: null });
    await ref.incState({ calls: 2 });
    await ref.pushState("errors", "again");
    expect(await readStored(stores, key)).toEqual({ calls: 2, errors: ["again"] });
  });

  it("treats a field named after an Object.prototype member as first touch", async () => {
    // A plain object INHERITS `constructor`, `toString`, `valueOf` and the rest
    // of `Object.prototype`, so `current[field]` on a field the object does not
    // own resolves a function rather than `undefined`. A type guard reading the
    // field bare then reports the most ordinary write there is — a first touch
    // — as a wrong-typed target. Same own-property hazard as FIX-965 in the
    // task collection, and it is reachable here because state field names come
    // from the caller: `incState({ [providerName]: 1 })` over a tally.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = await seedHandle(ctx, kind, {});

    await ref.incState({ constructor: 1 });
    await ref.pushState("toString", "first");
    await ref.incState({ valueOf: 2, hasOwnProperty: 3 });

    const stored = (await readStored(stores, key))!;
    expect(Object.keys(stored).sort()).toEqual([
      "constructor",
      "hasOwnProperty",
      "toString",
      "valueOf"
    ]);
    expect(stored["constructor"]).toBe(1);
    expect(stored["toString"]).toEqual(["first"]);
    expect(stored["valueOf"]).toBe(2);
    expect(stored["hasOwnProperty"]).toBe(3);

    // Second touch reads the OWN value rather than starting over.
    await ref.incState({ constructor: 4 });
    expect((await readStored(stores, key))!["constructor"]).toBe(5);
  });

  it("still refuses a prototype-named field whose OWN value is wrong-typed", async () => {
    // The other half of the guard, and what stops the fix above from being
    // "skip the check for these names": once the object owns the field, its own
    // value decides.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = await seedHandle(ctx, kind, { constructor: "nope", toString: 7 });

    await expect(ref.incState({ constructor: 1 })).rejects.toThrow(
      /"constructor" is not a number \(got string\)/
    );
    await expect(ref.pushState("toString", "x")).rejects.toThrow(
      /"toString" is not an array \(got number\)/
    );

    const stored = (await readStored(stores, key))!;
    expect(stored["constructor"]).toBe("nope");
    expect(stored["toString"]).toBe(7);
  });

  it("re-runs against the winner's row instead of refusing on a stale wrong-typed value", async () => {
    // The row that distinguishes decision 1 as specified from a naive type
    // check. `runResourceCAS` calls the mutator UNGUARDED and reaches `persist`
    // only afterwards, so a refusal thrown from inside it propagates before any
    // conflict is observed — the driver never refreshes and never re-runs. A
    // caller whose cached value was replaced meanwhile would then fail
    // terminally over a value the store no longer holds.
    const stores = createInMemoryStores();
    const ctxA = await makeCtx(stores, "req_a");
    const refA = await seedHandle(ctxA, kind, { errors: "was-a-string" });

    // B caches the string.
    const ctxB = await makeCtx(stores, "req_b");
    const refB = await getHandle(ctxB, kind);

    // A replaces it with a valid list.
    await refA.setState({ errors: ["fixed"] });

    // B's cached row says "string"; the row it would actually commit against
    // says "array". It must refresh and re-run, not refuse.
    await expect(refB.pushState("errors", "second")).resolves.toBeUndefined();

    expect(await readStored(stores, key)).toEqual({ errors: ["fixed", "second"] });
  });

  it("refuses a whole multi-field incState when one field is wrong-typed", async () => {
    // One call is one mutation: no partial application.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = await seedHandle(ctx, kind, { good: 1, bad: "nope" });

    await expect(ref.incState({ good: 1, bad: 1 })).rejects.toThrow(/not a number/);

    expect(await readStored(stores, key)).toEqual({ good: 1, bad: "nope" });
  });

  it("refuses a non-finite incState result and leaves the stored value intact", async () => {
    // Why this is refused rather than stored: `z.number()` ACCEPTS ±Infinity,
    // so the schema-validation path does not catch it, and the adapters then
    // disagree about what got written. The memory store keeps `Infinity`; every
    // JSON-serializing adapter (SQLite, Postgres, filesystem) turns it into
    // `null` — the same call leaving different stored state on different
    // adapters. That premise, pinned:
    expect(JSON.parse(JSON.stringify({ n: Infinity })).n).toBeNull();

    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = await seedHandle(ctx, kind, { n: Number.MAX_VALUE });

    // Overflow from two FINITE operands — no non-finite argument anywhere. A
    // check on the delta cannot see this by construction; only a check on the
    // result catches it.
    await expect(ref.incState({ n: Number.MAX_VALUE })).rejects.toThrow(/not finite/);
    expect(await readStored(stores, key)).toEqual({ n: Number.MAX_VALUE });

    // And the direct form.
    await expect(ref.incState({ n: Infinity })).rejects.toThrow(/not finite/);
    expect(await readStored(stores, key)).toEqual({ n: Number.MAX_VALUE });
  });

  it("leaves the existing mutators unchanged and writes nothing for a no-op increment", async () => {
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_a");
    const ref = await seedHandle(ctx, kind, { calls: 1, note: "keep" });

    await ref.patchState({ note: "patched" });
    await ref.updateState((s: JsonObject) => ({ ...s, via: "update" }));
    await ref.setState({ calls: 1, note: "patched", via: "update" });
    expect(await readStored(stores, key)).toEqual({
      calls: 1,
      note: "patched",
      via: "update"
    });

    // A no-op increment writes nothing and does not bump the version — which is
    // what makes `committed: false` safe to gate the change notification on.
    const before = await readVersion(stores, key);
    await ref.incState({ calls: 0 });
    expect(await readVersion(stores, key)).toBe(before);
  });
});

/**
 * The refusal contract on a schema that REWRITES its input, driven end to end.
 *
 * The suite above uses `passthrough()` schemas, which parse a cached row to
 * itself — so a refusal that hands the basis back stays deep-equal wherever the
 * write-path parse sits, and this hole stays invisible. A schema that fills a
 * `.default()` the row lacks turns that untouched basis into a different object,
 * and a refusal routed through the parse then looks like a real write.
 *
 * Both ref factories, per BP-035, entering through the two routes that actually
 * put an un-normalized row in front of the verbs: a collection instance reads
 * the raw store row, and a single reads its declared `default` verbatim when no
 * row has ever been persisted. (`resource-registry.spec.ts` covers the same
 * contract at the registry seam, where the stripping and stale-basis variants
 * are reachable too.)
 */
describe("FIX-1269 delta refusal on a rewriting schema", () => {
  // `tier` joined the schema after these rows were written — the ordinary
  // BP-030 drift, not an exotic schema.
  const drifted = z.object({ tier: z.string().default("free") }).passthrough();

  function makeDriftedFlow() {
    return defineFlow({
      kind: "fix1269-delta-drift",
      actions: {
        run: {
          inputSchema: z.string(),
          block: handler({
            name: "noop",
            resources: {
              // No row is ever persisted for this one, so the registry reads
              // the declared default — which nothing parses on the way in.
              legacyCounter: defineResource({
                scope: "session",
                stateSchema: drifted,
                default: { calls: "not-a-number" }
              }),
              legacyTallies: defineResourceCollection({
                scope: "session",
                pattern: "legacy-tallies/**",
                stateSchema: drifted
              })
            },
            execute: () => "ok"
          })
        }
      }
    })();
  }

  const makeDriftedCtx = (stores: StoreRegistry) =>
    createExecutionContext({
      flow: makeDriftedFlow(),
      actionName: "run",
      requestId: "req_a",
      sessionId: "sess_1",
      userId: "user_1",
      stores
    });

  it("refuses without creating a row for a single resource on its declared default", async () => {
    const stores = createInMemoryStores();
    const ctx = await makeDriftedCtx(stores);
    // Nothing persisted yet: the refusal below has no row to leave alone, so
    // what it must not do is bring one into existence.
    expect(await readStored(stores, "legacyCounter")).toBeUndefined();

    await expect((ctx.resources as any).legacyCounter.incState({ calls: 1 })).rejects.toThrow(
      /"calls" is not a number \(got string\)/
    );

    expect(await readStored(stores, "legacyCounter")).toBeUndefined();
    expect(await readVersion(stores, "legacyCounter")).toBeUndefined();

    // The path can write: the same handle persists a real increment, so the
    // absence above is a result rather than a resource that never reached the
    // store at all.
    await (ctx.resources as any).legacyCounter.incState({ other: 1 });
    expect(await readStored(stores, "legacyCounter")).toEqual({
      calls: "not-a-number",
      other: 1,
      tier: "free"
    });
  });

  it("refuses without writing for a collection instance holding a pre-drift row", async () => {
    const stores = createInMemoryStores();
    // A row written before `tier` existed. The collection cache is the raw
    // store row, so this is what the verbs see.
    await stores.resourceState.set("session", "sess_1", "legacy-tallies/t1", {
      calls: "not-a-number"
    }, "any");
    const before = await readVersion(stores, "legacy-tallies/t1");

    const ctx = await makeDriftedCtx(stores);
    const ref = await (ctx.resources as any).legacyTallies.get("t1");

    await expect(ref.incState({ calls: 1 })).rejects.toThrow(
      /"calls" is not a number \(got string\)/
    );

    expect(await readStored(stores, "legacy-tallies/t1")).toEqual({ calls: "not-a-number" });
    expect(await readVersion(stores, "legacy-tallies/t1")).toBe(before);

    await ref.incState({ other: 1 });
    expect(await readVersion(stores, "legacy-tallies/t1")).toBe(before! + 1);
  });
});

/**
 * A state field literally named `__proto__`.
 *
 * Two hazards meet on this one name and only the first belongs to the verbs:
 *
 *  - `current["__proto__"]` on a plain object resolves `Object.prototype`, so a
 *    bare read makes a first touch look like an object-valued field; and
 *    `next["__proto__"] = value` sets the object's prototype rather than
 *    creating an own property — a write that reports success and stores nothing.
 *  - one layer ABOVE the verbs, zod rebuilds a `ZodObject`'s output with plain
 *    assignment, so `parseResourceWriteState` drops the key on ANY object
 *    stateSchema. Nothing in the delta path can reach that.
 *
 * The fixture's schema therefore returns its input unchanged, which takes the
 * second hazard out of the picture and leaves the delta path's own guarantee
 * visible. That premise is pinned as an assertion below rather than asserted in
 * prose.
 */
describe.each(HANDLE_KINDS)("FIX-1269 a __proto__ field on a %s", (kind) => {
  const passthroughState = z.custom<JsonObject>(
    (v) => typeof v === "object" && v !== null && !Array.isArray(v)
  );

  const protoKey = kind === "single resource" ? "protoCounter" : "proto-tallies/t1";

  function makeProtoFlow() {
    return defineFlow({
      kind: "fix1269-delta-proto",
      actions: {
        run: {
          inputSchema: z.string(),
          block: handler({
            name: "noop",
            resources: {
              protoCounter: defineResource({
                scope: "session",
                stateSchema: passthroughState,
                default: {}
              }),
              protoTallies: defineResourceCollection({
                scope: "session",
                pattern: "proto-tallies/**",
                stateSchema: passthroughState
              })
            },
            execute: () => "ok"
          })
        }
      }
    })();
  }

  async function protoRef(stores: StoreRegistry): Promise<ResourceRef<JsonObject>> {
    const ctx = await createExecutionContext({
      flow: makeProtoFlow(),
      actionName: "run",
      requestId: "req_a",
      sessionId: "sess_1",
      userId: "user_1",
      stores
    });
    if (kind === "single resource") {
      return (ctx.resources as any).protoCounter as ResourceRef<JsonObject>;
    }
    await (ctx.resources as any).protoTallies.create("t1", {});
    return (await (ctx.resources as any).protoTallies.get("t1")) as ResourceRef<JsonObject>;
  }

  it("round-trips a __proto__ field: stored as an own property and readable back", async () => {
    // The premise for the fixture, measured rather than asserted in prose: an
    // ordinary object schema drops the key at the write-path parse, one layer
    // above the delta path.
    const own = {};
    Object.defineProperty(own, "__proto__", {
      value: 1,
      enumerable: true,
      writable: true,
      configurable: true
    });
    const viaObjectSchema = z.object({}).passthrough().parse(own);
    expect(Object.prototype.hasOwnProperty.call(viaObjectSchema, "__proto__")).toBe(false);

    const stores = createInMemoryStores();
    const ref = await protoRef(stores);

    // Computed keys throughout: `{ __proto__: 1 }` written as a plain property
    // in an object literal is the prototype-setter syntax, not a key.
    await ref.incState({ ["__proto__"]: 1 });

    const stored = (await readStored(stores, protoKey))!;
    expect(Object.prototype.hasOwnProperty.call(stored, "__proto__")).toBe(true);
    expect(stored["__proto__"]).toBe(1);
    expect(Object.keys(stored)).toEqual(["__proto__"]);
    // ...and readable back off the handle, not only out of the store.
    expect((ref.state as JsonObject)["__proto__"]).toBe(1);

    // A second touch reads the stored own value rather than starting from 0.
    await ref.incState({ ["__proto__"]: 4 });
    expect((await readStored(stores, protoKey))!["__proto__"]).toBe(5);
  });

  it("appends to a __proto__ field rather than refusing it as a non-array", async () => {
    const stores = createInMemoryStores();
    const ref = await protoRef(stores);

    await ref.pushState("__proto__", "first");
    await ref.pushState("__proto__", "second");

    const stored = (await readStored(stores, protoKey))!;
    expect(Object.prototype.hasOwnProperty.call(stored, "__proto__")).toBe(true);
    expect(stored["__proto__"]).toEqual(["first", "second"]);
  });
});

/**
 * FIX-1269 (follow-up) — a delta whose RESULT fails `stateSchema` must be
 * judged against a verified basis, exactly like a wrong-kind refusal.
 *
 * `runResourceCAS` calls its mutator unguarded, so a `ValidationError` thrown
 * from inside the write-path parse propagates before the driver observes any
 * conflict — no refresh, no re-run. A delta computed off a STALE cached row can
 * then fail over a value the store no longer holds, while the number it would
 * have produced against the live row is perfectly valid.
 *
 * This is the same failure mode the refusal deferral already fixed, one line
 * down the same mutator. Both ref factories, per BP-035.
 */
describe.each(HANDLE_KINDS)("FIX-1269 a schema-invalid delta on a %s", (kind) => {
  // A ceiling the delta can cross, so the parse — not the verbs — is what
  // rejects the result.
  const cappedState = z.object({ calls: z.number().max(10) }).passthrough();

  const cappedKey = kind === "single resource" ? "capped" : "capped-tallies/t1";

  function makeCappedFlow() {
    return defineFlow({
      kind: "fix1269-delta-capped",
      actions: {
        run: {
          inputSchema: z.string(),
          block: handler({
            name: "noop",
            resources: {
              capped: defineResource({
                scope: "session",
                stateSchema: cappedState,
                default: { calls: 0 }
              }),
              cappedTallies: defineResourceCollection({
                scope: "session",
                pattern: "capped-tallies/**",
                stateSchema: cappedState
              })
            },
            execute: () => "ok"
          })
        }
      }
    })();
  }

  const makeCappedCtx = (stores: StoreRegistry, requestId: string) =>
    createExecutionContext({
      flow: makeCappedFlow(),
      actionName: "run",
      requestId,
      sessionId: "sess_1",
      userId: "user_1",
      stores
    });

  async function seedCapped(ctx: any, initial: JsonObject): Promise<ResourceRef<JsonObject>> {
    if (kind === "single resource") {
      await ctx.resources.capped.setState(initial);
      return ctx.resources.capped as ResourceRef<JsonObject>;
    }
    await ctx.resources.cappedTallies.create("t1", initial);
    return (await ctx.resources.cappedTallies.get("t1")) as ResourceRef<JsonObject>;
  }

  async function getCapped(ctx: any): Promise<ResourceRef<JsonObject>> {
    return kind === "single resource"
      ? (ctx.resources.capped as ResourceRef<JsonObject>)
      : ((await ctx.resources.cappedTallies.get("t1")) as ResourceRef<JsonObject>);
  }

  it("re-runs against the winner's row instead of failing on a stale basis", async () => {
    const stores = createInMemoryStores();
    const ctxA = await makeCappedCtx(stores, "req_a");
    const refA = await seedCapped(ctxA, { calls: 10 });

    // B caches `calls: 10` — right at the ceiling.
    const ctxB = await makeCappedCtx(stores, "req_b");
    const refB = await getCapped(ctxB);

    // A resets the stored value. B's cached basis is now stale.
    await refA.setState({ calls: 0 });

    // Off B's cache the result is 11 and fails `.max(10)`. Off the row B would
    // actually commit against it is 1, which is fine — so this must land.
    await expect(refB.incState({ calls: 1 })).resolves.toBeUndefined();
    expect(await readStored(stores, cappedKey)).toEqual({ calls: 1 });
  });

  it("still fails loudly when the result is invalid against the verified row", async () => {
    // The half that keeps the fix from swallowing the genuine case.
    const stores = createInMemoryStores();
    const ctx = await makeCappedCtx(stores, "req_a");
    const ref = await seedCapped(ctx, { calls: 10 });
    const before = await readVersion(stores, cappedKey);

    await expect(ref.incState({ calls: 1 })).rejects.toThrow(/failed stateSchema validation/);

    expect(await readStored(stores, cappedKey)).toEqual({ calls: 10 });
    expect(await readVersion(stores, cappedKey)).toBe(before);
  });

  it("does not leave a stale verdict behind when a later call succeeds", async () => {
    // The deferred error is per-attempt state. A call that refused must not
    // make the next successful call on the same handle report a failure.
    const stores = createInMemoryStores();
    const ctx = await makeCappedCtx(stores, "req_a");
    const ref = await seedCapped(ctx, { calls: 10 });

    await expect(ref.incState({ calls: 1 })).rejects.toThrow(/failed stateSchema validation/);
    await expect(ref.incState({ calls: -4 })).resolves.toBeUndefined();

    expect(await readStored(stores, cappedKey)).toEqual({ calls: 6 });
  });
});
