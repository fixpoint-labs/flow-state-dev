/**
 * Tests for FIX-688 Slice 1 — configurable resource prefetch (build-time
 * provenance, pure `@flow-state-dev/core`). Covers:
 *   - `prefetchMode` field acceptance + default semantics on collections
 *     and single resources.
 *   - The lazy-collection-with-eviction build-time guard.
 *   - The flow-level lazy-single build-time guard (and the collection escape).
 *   - `BlockDefinition.ownDeclaredResources` provenance for leaf vs composite
 *     blocks (own declarations only, excluding descendants).
 *   - `FlowDefinition.flowLevelResourceKeys` capturing the flow's OWN
 *     `resources` keys before bubble-up.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, sequencer } from "../src";
import { defineResource } from "../src/types/resource";
import { defineResourceCollection } from "../src/types/resource-collection";
import type { ResourceRef } from "../src/types/resource";

// ---------------------------------------------------------------------------
// 1. prefetchMode on collections: explicit + default-undefined
// ---------------------------------------------------------------------------

describe("defineResourceCollection prefetchMode", () => {
  it("retains prefetchMode: 'lazy' on the returned config", () => {
    const coll = defineResourceCollection({
      pattern: "files/*",
      scope: "session",
      stateSchema: z.object({ language: z.string() }),
      prefetchMode: "lazy",
    });

    expect(coll.prefetchMode).toBe("lazy");
  });

  // 6. Mode propagation: ctx.resources.<key> narrows to the lazy ref shape
  // (async reads) for a lazy collection, and the eager (sync) shape otherwise.
  it("propagates the mode to ctx.resources read-method signatures (type-level)", () => {
    const lazyColl = defineResourceCollection({
      pattern: "files/*",
      scope: "session",
      stateSchema: z.object({ language: z.string() }),
      prefetchMode: "lazy",
    });
    const eagerColl = defineResourceCollection({
      pattern: "notes/*",
      scope: "session",
      stateSchema: z.object({ body: z.string() }),
    });

    handler({
      name: "mode-probe",
      resources: { files: lazyColl, notes: eagerColl },
      execute: (_v, ctx) => {
        // Lazy: list() is async.
        expectTypeOf(ctx.resources.files.list()).toEqualTypeOf<
          Promise<ResourceRef<{ language: string }>[]>
        >();
        // Lazy: count() is async.
        expectTypeOf(ctx.resources.files.count()).toEqualTypeOf<Promise<number>>();
        // Eager: list() is sync.
        expectTypeOf(ctx.resources.notes.list()).toEqualTypeOf<
          ResourceRef<{ body: string }>[]
        >();
        // Eager: count() is sync.
        expectTypeOf(ctx.resources.notes.count()).toEqualTypeOf<number>();
        return _v;
      },
    });

    // No runtime assertion needed — the type assertions above are the test.
    expect(true).toBe(true);
  });

  it("leaves prefetchMode undefined when omitted (eager-by-default)", () => {
    const coll = defineResourceCollection({
      pattern: "files/*",
      scope: "session",
      stateSchema: z.object({ language: z.string() }),
    });

    expect(coll.prefetchMode).toBeUndefined();
  });

  // 2. lazy + non-'none' eviction must throw
  it("throws when prefetchMode: 'lazy' is combined with an eviction policy", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "files/*",
        scope: "session",
        stateSchema: z.object({ language: z.string() }),
        prefetchMode: "lazy",
        eviction: "lru",
        maxInstances: 100,
      })
    ).toThrow(/lazy collections only hold a partial cache/);
  });

  it("allows prefetchMode: 'lazy' with eviction: 'none'", () => {
    expect(() =>
      defineResourceCollection({
        pattern: "files/*",
        scope: "session",
        stateSchema: z.object({ language: z.string() }),
        prefetchMode: "lazy",
        eviction: "none",
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. prefetchMode on single resources: accepted, no throw
// ---------------------------------------------------------------------------

describe("defineResource prefetchMode", () => {
  it("accepts prefetchMode: 'lazy' on a single resource", () => {
    const res = defineResource({
      scope: "session",
      stateSchema: z.object({ count: z.number() }),
      prefetchMode: "lazy",
    });

    expect(res.prefetchMode).toBe("lazy");
  });
});

// ---------------------------------------------------------------------------
// 4. Flow-level lazy single throws; flow-level lazy collection allowed
// ---------------------------------------------------------------------------

describe("defineFlow lazy flow-level resource validation", () => {
  it("throws when a single resource declared at flow level is prefetchMode: 'lazy'", () => {
    const lazySingle = defineResource({
      scope: "session",
      stateSchema: z.object({ count: z.number() }),
      prefetchMode: "lazy",
    });

    expect(() =>
      defineFlow({
        kind: "lazy-single-flow",
        actions: {
          run: {
            inputSchema: z.any(),
            block: handler({ name: "noop", execute: (v) => v }),
          },
        },
        resources: { lazyThing: lazySingle },
      })
    ).toThrow(
      "Single-resource 'lazyThing' declared at flow level cannot be prefetchMode: 'lazy'"
    );
  });

  it("does not throw when a collection declared at flow level is prefetchMode: 'lazy'", () => {
    const lazyColl = defineResourceCollection({
      pattern: "files/*",
      scope: "session",
      stateSchema: z.object({ language: z.string() }),
      prefetchMode: "lazy",
    });

    expect(() =>
      defineFlow({
        kind: "lazy-coll-flow",
        actions: {
          run: {
            inputSchema: z.any(),
            block: handler({ name: "noop", execute: (v) => v }),
          },
        },
        resources: { files: lazyColl },
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5 & 6. ownDeclaredResources provenance
// ---------------------------------------------------------------------------

describe("BlockDefinition.ownDeclaredResources", () => {
  const resA = defineResource({
    scope: "session",
    ref: "a",
    stateSchema: z.object({ a: z.number() }),
  });
  const resB = defineResource({
    scope: "session",
    ref: "b",
    stateSchema: z.object({ b: z.number() }),
  });

  it("equals the leaf handler's own declarations (same as declaredResources)", () => {
    const block = handler({
      name: "leaf",
      resources: { foo: resA },
      execute: (v) => v,
    });

    expect(block.ownDeclaredResources?.foo).toBe(resA);
    expect(block.declaredResources?.foo).toBe(resA);
  });

  it("excludes children's declarations on a sequencer (bubble-up keeps them)", () => {
    const handlerA = handler({
      name: "a",
      resources: { a: resA },
      execute: (v) => v,
    });
    const handlerB = handler({
      name: "b",
      resources: { b: resB },
      execute: (v) => v,
    });

    const seq = sequencer({ name: "seq" }).step(handlerA).step(handlerB);

    // Bubble-up: declaredResources contains both children's resources.
    expect(seq.declaredResources?.a).toBe(resA);
    expect(seq.declaredResources?.b).toBe(resB);

    // Own: a plain sequencer declares no resources of its own (no `resources`
    // config field, no capabilities), so ownDeclaredResources is undefined.
    expect(seq.ownDeclaredResources).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. FlowDefinition.flowLevelResourceKeys
// ---------------------------------------------------------------------------

describe("FlowDefinition.flowLevelResourceKeys", () => {
  it("captures exactly the flow's own resources keys, not block-bubbled keys", () => {
    const flowRes = defineResource({
      scope: "session",
      ref: "flow-res",
      stateSchema: z.object({ x: z.number() }),
    });
    const blockRes = defineResource({
      scope: "session",
      ref: "block-res",
      stateSchema: z.object({ y: z.number() }),
    });

    const block = handler({
      name: "with-block-res",
      resources: { fromBlock: blockRes },
      execute: (v) => v,
    });

    const flow = defineFlow({
      kind: "keys-flow",
      actions: {
        run: { inputSchema: z.any(), block },
      },
      resources: { fromFlow: flowRes },
    });

    // Only the flow's own declaration key is captured.
    expect([...flow.flowLevelResourceKeys].sort()).toEqual(["fromFlow"]);

    // Sanity: the bubbled block resource is still in the merged map.
    expect(flow.resources?.fromBlock).toBe(blockRes);
    expect(flow.resources?.fromFlow).toBe(flowRes);
  });

  it("is an empty set when the flow declares no own resources", () => {
    const flow = defineFlow({
      kind: "no-own-res",
      actions: {
        run: {
          inputSchema: z.any(),
          block: handler({ name: "noop", execute: (v) => v }),
        },
      },
    });

    expect(flow.flowLevelResourceKeys.size).toBe(0);
  });
});
