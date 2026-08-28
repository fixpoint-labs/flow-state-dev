/**
 * FIX-1260 — a resource state schema must never move the stored value on its own.
 *
 * Every case drives the REAL path: `createExecutionContext` over
 * `createInMemoryStores`, asserting on the DURABLE row rather than on what a
 * ref reports. That distinction is the whole point — the defect is invisible
 * from `ref.state`, because the same normalization that corrupts the stored
 * row also re-applies on the way out, so the reader sees a plausible value.
 *
 * Rows are seeded with `stores.resourceState.set(...)` rather than through the
 * registry. A row written before this fix (or before its schema grew a field)
 * is exactly what is on disk today, and seeding it through the registry would
 * launder it through the very parse under test.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import type { JsonObject } from "@flow-state-dev/core/types";
import {
  createExecutionContext,
  createInMemoryStores,
  type StoreRegistry
} from "../src";

/**
 * Non-idempotent: parsing an already-parsed value moves `n` again. This is the
 * shape that drifts — `.transform()` whose output is not a fixed point.
 */
const driftingSchema = z.object({
  n: z.number().transform((v) => v + 1),
  tag: z.string().optional()
});

/**
 * Idempotent transform, and the reason "ban `.transform()`" is the wrong fix:
 * this is the codebase's own BP-030 legacy-tolerance idiom (see
 * `activeSkillsArraySchema` in `@flow-state-dev/orchestration`) — tolerate a
 * retired enum value on read, normalize it forward. Parsing twice yields the
 * same value, so nothing drifts and these writes must keep working.
 */
const stableTransformSchema = z.object({
  mode: z
    .enum(["inline", "fork"])
    .catch("inline")
    .transform(() => "inline" as const),
  tag: z.string().optional(),
  // Declared because `z.object` strips unknown keys: the CAS case below needs
  // two writers on two DIFFERENT fields, and an undeclared one would be
  // stripped by the parse rather than lost by the race, which is a passing
  // test for the wrong reason.
  other: z.string().optional()
});

/** A field added to the schema after rows were already on disk. */
const defaultingSchema = z.object({
  n: z.number().default(0),
  tag: z.string().optional()
});

/**
 * Unstable AND able to parse a seed away to `null`: `{}` becomes `{phase:1}`,
 * `{phase:1}` becomes `{phase:2}` (so it never settles), and an explicit
 * `{phase:0}` becomes `null`.
 *
 * `phase` is `.optional()` rather than `.default(0)` on purpose — "absent" and
 * "explicitly 0" have to stay distinguishable, because those are exactly the
 * two seeds `create` can be handed, and the pair of cases below turns on the
 * write path answering them the same way.
 */
const nullingSchema = z
  .object({ phase: z.number().optional() })
  .transform((v) => (v.phase === 0 ? null : { phase: (v.phase ?? 0) + 1 }));

/**
 * Nullable and settled: `{}` parses to `{}`, which is the cleared form a null
 * write persists, so it is already its own fixed point. The control for the
 * null branch — this is the ordinary `.nullable()` resource whose documented
 * `setState(null)` reset must keep working.
 */
const stableNullableSchema = z.object({ note: z.string().optional() }).nullable();

const drifting = defineResource({
  scope: "session",
  stateSchema: driftingSchema,
  default: { n: 0 }
});

const stable = defineResource({
  scope: "session",
  stateSchema: stableTransformSchema,
  default: { mode: "inline" }
});

const defaulted = defineResource({
  scope: "session",
  stateSchema: defaultingSchema,
  default: { n: 0 }
});

const driftingItems = defineResourceCollection({
  scope: "session",
  pattern: "driftingItems/**",
  stateSchema: driftingSchema
});

const defaultedItems = defineResourceCollection({
  scope: "session",
  pattern: "defaultedItems/**",
  stateSchema: defaultingSchema
});

const nullingItems = defineResourceCollection({
  scope: "session",
  pattern: "nullingItems/**",
  stateSchema: nullingSchema
});

const clearable = defineResource({
  scope: "session",
  stateSchema: stableNullableSchema
});

const clearableItems = defineResourceCollection({
  scope: "session",
  pattern: "clearableItems/**",
  stateSchema: stableNullableSchema
});

function makeFlow() {
  return defineFlow({
    kind: "fix1260-drift",
    actions: {
      run: {
        inputSchema: z.string(),
        block: handler({
          name: "noop",
          resources: {
            drifting,
            stable,
            defaulted,
            driftingItems,
            defaultedItems,
            nullingItems,
            clearable,
            clearableItems
          },
          execute: () => "ok"
        })
      }
    }
  })();
}

/**
 * One execution context = one in-flight request. A fresh context re-runs the
 * load-path normalization, which is where half the drift enters, so "how many
 * contexts" is load-bearing in every case below.
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

/** Seed a durable row exactly as it sits on disk, bypassing every parse. */
async function seedStored(
  stores: StoreRegistry,
  key: string,
  state: JsonObject
): Promise<void> {
  await stores.resourceState.set("session", "sess_1", key, state, "any");
}

describe("FIX-1260: a state schema never moves the stored value on its own", () => {
  it("holds a single resource's untouched field steady across successive writes", async () => {
    const stores = createInMemoryStores();
    // Seeded at 41, not at the schema's default of 0: a value only a previous
    // write could have put there, so "the row held" and "the default re-derived
    // it" are distinguishable outcomes. A drifting schema would climb off it,
    // and a re-derived one would snap to 0 — neither reads as 41.
    await seedStored(stores, "defaulted", { n: 41, tag: "seed" });

    // Three writes, each in its own context (one request apiece), none of which
    // mentions `n`. Every one of them succeeds — this is the case for what a
    // caller's ordinary write must NOT do to a field it never named, so it is
    // driven through a schema whose parse settles. The refusal cases are below.
    for (const [i, tag] of ["a", "b", "c"].entries()) {
      const ctx = await makeCtx(stores, `req_${i}`);
      await (ctx.resources.defaulted as any).patchState({ tag });
      expect(await readStored(stores, "defaulted")).toEqual({ n: 41, tag });
    }
  });

  it("refuses a write through an unstable schema instead of corrupting the row", async () => {
    const stores = createInMemoryStores();
    await seedStored(stores, "drifting", { n: 0 });
    const ctx = await makeCtx(stores, "req_1");

    // Loud, not silent. The caller finds out at the write, naming the resource
    // and the field the second parse moved.
    await expect((ctx.resources.drifting as any).patchState({ tag: "a" })).rejects.toThrow(
      /Resource "drifting" write failed stateSchema validation at "n"/
    );
    // And the row is untouched — a refused write leaves no partial state.
    expect(await readStored(stores, "drifting")).toEqual({ n: 0 });
  });

  it("holds a collection instance's untouched field steady too", async () => {
    // Second write site (BP-035): collection instances persist through
    // `persistNamespaceInstanceState`, a different function from the single's
    // path. A suite covering only singles passes while every instance drifts.
    const stores = createInMemoryStores();
    await seedStored(stores, "defaultedItems/one", { n: 41, tag: "seed" });

    for (const [i, tag] of ["a", "b"].entries()) {
      const ctx = await makeCtx(stores, `req_${i}`);
      const instance = await (ctx.resources.defaultedItems as any).get("one");
      await instance.patchState({ tag });
      expect(await readStored(stores, "defaultedItems/one")).toEqual({ n: 41, tag });
    }
  });

  it("refuses a write on a collection instance through an unstable schema", async () => {
    // The refusal has to reach the instance write path as well, and that is a
    // different function from the single's. It also no longer rides along on the
    // steady case above, which now drives a schema that settles.
    const stores = createInMemoryStores();
    await seedStored(stores, "driftingItems/one", { n: 0 });
    const ctx = await makeCtx(stores, "req_1");

    const instance = await (ctx.resources.driftingItems as any).get("one");
    await expect(instance.patchState({ tag: "a" })).rejects.toThrow(
      /Resource "driftingItems\/one" write failed stateSchema validation at "n"/
    );
    expect(await readStored(stores, "driftingItems/one")).toEqual({ n: 0 });
  });

  it("refuses collection.create() through an unstable schema", async () => {
    // `create` seeds the row the mutation verbs will later read-modify-write, so
    // a create held to a weaker bar than they use only moves the failure to the
    // first patch — where it reads as "patch is broken". The README and the
    // release note both claim `create` is guarded; this is what that rests on.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_1");

    await expect(
      (ctx.resources.driftingItems as any).create("fresh", { n: 0 })
    ).rejects.toThrow(
      /Resource "driftingItems\/fresh" write failed stateSchema validation at "n"/
    );
    // Refused means no row, not a row nobody can write to.
    expect(await readStored(stores, "driftingItems/fresh")).toBeUndefined();
  });

  it("refuses collection.create() the same way whether or not a seed parses to null", async () => {
    // Both halves of one verb. The seed decides which branch of the write path
    // the create takes, and before this fix the two branches disagreed: a bare
    // create was refused while a create whose seed the schema parsed away to
    // `null` committed — same verb, same resulting row (`{}`), opposite answers,
    // with the failure merely deferred to the instance's first patch. That is
    // the weaker bar the create-guard case above says must not exist.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_1");

    // No initial state: the seed is the schema's parse of `{}`, an object, so
    // this half already reached the guard.
    await expect((ctx.resources.nullingItems as any).create("bare")).rejects.toThrow(
      /Resource "nullingItems\/bare" write failed stateSchema validation at "phase"/
    );

    // An initial state the schema parses to `null`. `{}` is what would be
    // stored and what the next read would parse, so `{}` is what has to settle
    // — and it does not, so this half is refused now too, in the same words.
    await expect(
      (ctx.resources.nullingItems as any).create("seeded", { phase: 0 })
    ).rejects.toThrow(
      /Resource "nullingItems\/seeded" write failed stateSchema validation at "phase"/
    );

    // Neither leaves a durable row...
    expect(await readStored(stores, "nullingItems/bare")).toBeUndefined();
    expect(await readStored(stores, "nullingItems/seeded")).toBeUndefined();

    // ...nor an instance to enumerate, in this context or in a fresh one that
    // re-reads the store. A create that "succeeded" into an unwritable row
    // would show up here.
    expect(await (ctx.resources.nullingItems as any).list()).toEqual([]);
    const fresh = await makeCtx(stores, "req_2");
    expect(await (fresh.resources.nullingItems as any).list()).toEqual([]);
  });

  it("still creates and writes through a nullable schema that settles from {}", async () => {
    // The control for the case above, on the same surface: nullable too, but
    // `{}` parses to `{}`, so it is its own fixed point. Without this, a passing
    // run would not show the guard discriminates rather than refusing every
    // nullable collection.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_1");

    await (ctx.resources.clearableItems as any).create("kept");
    expect(await readStored(stores, "clearableItems/kept")).toEqual({});

    const instance = await (ctx.resources.clearableItems as any).get("kept");
    await instance.setState({ note: "a" });
    expect(await readStored(stores, "clearableItems/kept")).toEqual({ note: "a" });

    // The following write is the half that matters: the create above is only
    // useful if the instance it seeded is actually writable.
    await instance.patchState({ note: "b" });
    expect(await readStored(stores, "clearableItems/kept")).toEqual({ note: "b" });

    expect(await (ctx.resources.clearableItems as any).list()).toHaveLength(1);
  });

  it("still clears an ordinary nullable resource with setState(null)", async () => {
    // `setState(null)` is the documented reset for a `.nullable()` resource and
    // is the one path the null branch's new check could have broken. It does
    // not: `{}` parses to `{}`, so the check short-circuits on `deepEqual`
    // before it ever re-parses. Anything else here would make this a breaking
    // change for real users.
    const stores = createInMemoryStores();
    await seedStored(stores, "clearable", { note: "seed" });
    const ctx = await makeCtx(stores, "req_1");

    await (ctx.resources.clearable as any).setState(null);
    expect(await readStored(stores, "clearable")).toEqual({});

    // And the cleared row is still a row you can write to, in a later request.
    const next = await makeCtx(stores, "req_2");
    await (next.resources.clearable as any).patchState({ note: "after" });
    expect(await readStored(stores, "clearable")).toEqual({ note: "after" });
  });

  it("does not drift when a CAS conflict re-runs the mutator", async () => {
    // The retry path seeds the mutator differently from the first attempt: on
    // conflict the driver commits the winner's RAW row into the container, so a
    // re-run parses from a different starting point. Drift that only appears
    // after a conflict is exactly what a single-write test misses.
    const stores = createInMemoryStores();
    await seedStored(stores, "stable", { mode: "inline" });

    const ctxA = await makeCtx(stores, "req_a");
    const ctxB = await makeCtx(stores, "req_b");

    await Promise.all([
      (ctxA.resources.stable as any).patchState({ tag: "a" }),
      (ctxB.resources.stable as any).patchState({ other: "b" })
    ]);

    // Both fields land (the CAS contract) and `mode` is still the one value the
    // schema normalizes to — not a second transform application.
    expect(await readStored(stores, "stable")).toMatchObject({
      mode: "inline",
      tag: "a",
      other: "b"
    });
  });

  it("refuses an unstable schema on the conflict-and-retry path too", async () => {
    // A retry re-runs the mutator against the winner's RAW row rather than the
    // normalized cache, so it is a genuinely different seed. It must not become
    // the one path a drifted value slips through.
    const stores = createInMemoryStores();
    await seedStored(stores, "drifting", { n: 0 });

    const ctxA = await makeCtx(stores, "req_a");
    const ctxB = await makeCtx(stores, "req_b");

    const results = await Promise.allSettled([
      (ctxA.resources.drifting as any).patchState({ tag: "a" }),
      (ctxB.resources.drifting as any).patchState({ tag: "b" })
    ]);

    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(await readStored(stores, "drifting")).toEqual({ n: 0 });
  });

  it("converges a legacy row when a CAS conflict re-runs the mutator", async () => {
    // The legacy shape (BP-030) and the retry path at once: the row predates the
    // defaulted field, so the loser's re-run seeds from a raw row that is NOT
    // yet a fixed point. Both writers' fields must land and `n` must be filled
    // exactly once, not once per attempt.
    const stores = createInMemoryStores();
    await seedStored(stores, "defaulted", { tag: "legacy" });

    const ctxA = await makeCtx(stores, "req_a");
    const ctxB = await makeCtx(stores, "req_b");

    await Promise.all([
      (ctxA.resources.defaulted as any).patchState({ tag: "a" }),
      (ctxB.resources.defaulted as any).patchState({ n: 7 })
    ]);

    const stored = await readStored(stores, "defaulted");
    expect(stored).toHaveProperty("tag", "a");
    // 7 if B's explicit write won the merge, 0 if the default filled it — never
    // 8, which is what a second normalization pass on the retry would produce.
    expect([0, 7]).toContain((stored as { n: number }).n);
  });

  it("keeps an idempotent transform working across repeated writes", async () => {
    // The control that stops the fix from becoming "ban .transform()". A
    // retired enum value on disk normalizes forward on read, and repeated
    // writes hold it there.
    const stores = createInMemoryStores();
    await seedStored(stores, "stable", { mode: "fork" });

    for (const [i, tag] of ["a", "b", "c"].entries()) {
      const ctx = await makeCtx(stores, `req_${i}`);
      await (ctx.resources.stable as any).patchState({ tag });
      expect(await readStored(stores, "stable")).toMatchObject({ mode: "inline", tag });
    }
  });

  it("still fills a default on a resource the store has never held", async () => {
    // The other control: defaults must keep populating. A fix that refused to
    // let parse change the value at all would break this.
    const stores = createInMemoryStores();
    const ctx = await makeCtx(stores, "req_1");

    await (ctx.resources.defaulted as any).setState({ tag: "first" });

    expect(await readStored(stores, "defaulted")).toEqual({ n: 0, tag: "first" });
  });

  it("normalizes a row stored before its schema gained a defaulted field", async () => {
    // BP-030: rows written under the old shape are already on disk. Reading one
    // must fill the field the schema's output type promises is there, and a
    // subsequent write must converge the stored row rather than re-deriving it
    // forever.
    const stores = createInMemoryStores();
    await seedStored(stores, "defaulted", { tag: "legacy" });

    const ctx = await makeCtx(stores, "req_1");
    expect((ctx.resources.defaulted as any).state).toMatchObject({ n: 0, tag: "legacy" });

    await (ctx.resources.defaulted as any).patchState({ tag: "updated" });
    expect(await readStored(stores, "defaulted")).toEqual({ n: 0, tag: "updated" });
  });

  it("normalizes a legacy collection instance row on write", async () => {
    const stores = createInMemoryStores();
    await seedStored(stores, "defaultedItems/one", { tag: "legacy" });

    const ctx = await makeCtx(stores, "req_1");
    const instance = await (ctx.resources.defaultedItems as any).get("one");
    await instance?.patchState({ tag: "updated" });

    expect(await readStored(stores, "defaultedItems/one")).toEqual({
      n: 0,
      tag: "updated"
    });
  });
});
