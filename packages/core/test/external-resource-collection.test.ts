import { describe, expect, it, expectTypeOf } from "vitest";
import { z } from "zod";
import {
  defineExternalResourceCollection,
  isExternalResourceCollection,
  type ExternalResourceCollectionRef,
} from "../src/types/external-resource-collection";
import {
  defineResourceCollection,
  isDefinedResourceCollection,
} from "../src/types/resource-collection";
import { defineResource } from "../src/types/resource";
import { handler } from "../src";
import { extractDeclaredResources, mergeDeclaredResources } from "../src/blocks/internal/build-block";

const positionSchema = z.object({
  ticker: z.string().default(""),
  shares: z.number().default(0),
});

function definePositions(overrides: Record<string, unknown> = {}) {
  return defineExternalResourceCollection({
    pattern: "positions/*",
    scope: "user",
    stateSchema: positionSchema,
    read: async () => null,
    search: async () => ({ hits: [] }),
    ...overrides,
  });
}

describe("defineExternalResourceCollection", () => {
  it("emits a collection branded external + ResourceCollection", () => {
    const coll = definePositions();
    // Retains the collection brand so flow-merge / addressing treat it as a
    // collection unchanged...
    expect(isDefinedResourceCollection(coll)).toBe(true);
    // ...and carries the external brand for read-through classification.
    expect(isExternalResourceCollection(coll)).toBe(true);
    expect((coll as { external?: unknown }).external).toBe(true);
    expect(coll.pattern).toBe("positions/*");
    expect(coll.scope).toBe("user");
  });

  it("does not misclassify a normal collection as external", () => {
    const normal = defineResourceCollection({
      pattern: "notes/*",
      scope: "user",
      stateSchema: z.object({ body: z.string().default("") }),
    });
    expect(isExternalResourceCollection(normal)).toBe(false);
  });

  it("keeps the read / search backing hooks on the definition", () => {
    const coll = definePositions();
    expect(typeof (coll as { read?: unknown }).read).toBe("function");
    expect(typeof (coll as { search?: unknown }).search).toBe("function");
  });

  it("flows through declared-resource extract + merge as a collection", () => {
    const coll = definePositions();
    const declared = extractDeclaredResources({ resources: { portfolio: coll } });
    expect(declared!.portfolio).toBe(coll);
    // Same accessor + same ref merges without a conflict, like any collection.
    const merged = mergeDeclaredResources(
      { portfolio: coll as any },
      { portfolio: coll as any }
    );
    expect(merged.portfolio).toBe(coll);
  });

  describe("validation", () => {
    it("rejects a parameterized [name] pattern (wildcard-only)", () => {
      expect(() =>
        definePositions({ pattern: "[symbol]/position" })
      ).toThrow(/wildcard pattern/i);
    });

    it("accepts a deep-wildcard pattern", () => {
      expect(() => definePositions({ pattern: "positions/**" })).not.toThrow();
    });

    it("requires an explicit session|user|org scope", () => {
      expect(() => definePositions({ scope: "request" })).toThrow(/scope/i);
    });

    it("rejects client.content.create/update/delete (read-only)", () => {
      expect(() =>
        definePositions({ client: { content: { create: true } } })
      ).toThrow(/read-only/i);
      expect(() =>
        definePositions({ client: { content: { update: true } } })
      ).toThrow(/read-only/i);
      expect(() =>
        definePositions({ client: { content: { delete: true } } })
      ).toThrow(/read-only/i);
    });

    it("allows client.content.read + state.read", () => {
      expect(() =>
        definePositions({ client: { content: { read: true }, state: { read: true } } })
      ).not.toThrow();
    });

    it("rejects a contentUpdated reactTo binding (no content-write seam)", () => {
      const react = handler({ name: "r", execute: async () => ({}) });
      expect(() =>
        definePositions({ reactTo: { contentUpdated: react } as never })
      ).toThrow(/contentUpdated/i);
    });

    it("rejects declaring both contentTemplate and contentTemplateRef", () => {
      expect(() =>
        definePositions({ contentTemplate: "a", contentTemplateRef: "b" })
      ).toThrow(/template source/i);
    });
  });

  describe("read-only inference", () => {
    it("infers the read-only ref shape (no mutators) — type-level", () => {
      const coll = definePositions();
      type Refs = import("../src/types/block").InferResourcesFromDefinitions<{
        portfolio: typeof coll;
      }>;
      // The external collection resolves to the read-only ref...
      expectTypeOf<Refs["portfolio"]>().toEqualTypeOf<
        ExternalResourceCollectionRef<{ ticker: string; shares: number }>
      >();
      // ...which exposes get/getOptional but no create/upsert/delete.
      expectTypeOf<Refs["portfolio"]>().toHaveProperty("get");
      expectTypeOf<Refs["portfolio"]>().toHaveProperty("getOptional");
      expectTypeOf<Refs["portfolio"]>().not.toHaveProperty("create");
      expectTypeOf<Refs["portfolio"]>().not.toHaveProperty("upsert");
      expectTypeOf<Refs["portfolio"]>().not.toHaveProperty("delete");
    });

    it("a plain collection still infers the mutable ref — type-level", () => {
      const normal = defineResourceCollection({
        pattern: "notes/*",
        scope: "user",
        stateSchema: z.object({ body: z.string().default("") }),
      });
      type Refs = import("../src/types/block").InferResourcesFromDefinitions<{
        notes: typeof normal;
      }>;
      expectTypeOf<Refs["notes"]>().toHaveProperty("create");
    });
  });
});
