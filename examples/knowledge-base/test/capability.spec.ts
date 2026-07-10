import { describe, it, expect, vi } from "vitest";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createKnowledgeBaseCapability } from "../src/capability";
import type { ConceptState } from "../src/concepts";
import { makeConceptCollection, FIXTURE_BUNDLE } from "./helpers";

/** Build the capability and a minimal ctx whose `resources.concepts` is a real collection. */
function wire(collection: ResourceCollectionRef<ConceptState>) {
  const cap = createKnowledgeBaseCapability() as any;
  const ctx = { resources: { concepts: collection } };
  return { cap, ctx, fns: cap.fns(ctx) };
}

describe("createKnowledgeBaseCapability", () => {
  it("defines a knowledgeBase capability wrapping the concept collection", () => {
    const cap = createKnowledgeBaseCapability() as any;
    expect(cap.name).toBe("knowledgeBase");
    expect(cap.collection).toBeDefined();
    expect(cap.resources.concepts).toBeDefined();
  });

  it("fns import a bundle, list concept IDs, and read content", async () => {
    const collection = await makeConceptCollection();
    const { fns } = wire(collection);

    const res = await fns.importBundle(FIXTURE_BUNDLE);
    expect(res.imported).toBe(3);
    expect(await fns.listConcepts()).toEqual([
      "datasets/sales",
      "tables/customers",
      "tables/orders",
    ]);
    expect((await fns.readConcept("tables/orders")).body).toContain("# Schema");
    expect(await fns.readConcept("nope")).toBeNull();
  });

  it("fns.relate adds a typed link edge over the concept graph", async () => {
    const collection = await makeConceptCollection();
    const { fns } = wire(collection);
    await fns.importBundle(FIXTURE_BUNDLE);

    await fns.relate("tables/customers", "datasets/sales");
    const customers = await collection.get("tables/customers");
    expect(
      customers.edges!.all().some((e) => e.from === "tables/customers" && e.to === "datasets/sales"),
    ).toBe(true);
  });

  it("fns.relate rejects a relation to a non-existent target", async () => {
    const collection = await makeConceptCollection();
    const { fns } = wire(collection);
    await fns.importBundle(FIXTURE_BUNDLE);

    await expect(fns.relate("tables/customers", "nope")).rejects.toThrow();
  });

  describe("createConcept / updateConcept / deleteConcept", () => {
    it("creates a new concept whose state and body round-trip through readConcept", async () => {
      const collection = await makeConceptCollection();
      const { fns } = wire(collection);

      await fns.createConcept("widgets/gizmo", { type: "concept", title: "Gizmo" }, "A small gizmo.");
      const read = await fns.readConcept("widgets/gizmo");
      expect(read.state.type).toBe("concept");
      expect(read.state.title).toBe("Gizmo");
      expect(read.body).toBe("A small gizmo.");
    });

    it("throws when creating a concept id that already exists, without touching it", async () => {
      const collection = await makeConceptCollection();
      const { fns } = wire(collection);
      await fns.createConcept("widgets/gizmo", { type: "concept" }, "original");

      await expect(fns.createConcept("widgets/gizmo", { type: "concept" }, "clobber")).rejects.toThrow(
        /already exists/,
      );
      expect((await fns.readConcept("widgets/gizmo")).body).toBe("original");
    });

    it("rejects a concept id that collides with an OKF-reserved filename", async () => {
      const collection = await makeConceptCollection();
      const { fns } = wire(collection);

      await expect(fns.createConcept("index", { type: "concept" }, "body")).rejects.toThrow(/reserved/);
      await expect(fns.createConcept("log", { type: "concept" }, "body")).rejects.toThrow(/reserved/);
    });

    it("rolls back the state row when the body write fails", async () => {
      const collection = await makeConceptCollection();
      const { fns } = wire(collection);
      const failure = new Error("store unavailable");
      const originalCreate = collection.create.bind(collection);
      const createSpy = vi
        .spyOn(collection, "create")
        .mockImplementationOnce(async (...args: Parameters<typeof originalCreate>) => {
          const r = await originalCreate(...args);
          return { ...r, writeContent: async () => { throw failure; } };
        });

      await expect(fns.createConcept("widgets/broken", { type: "concept" }, "body")).rejects.toThrow(failure);
      expect(await fns.readConcept("widgets/broken")).toBeNull();
      createSpy.mockRestore();
    });

    it("updates an existing concept's state and body (partial)", async () => {
      const collection = await makeConceptCollection();
      const { fns } = wire(collection);
      await fns.createConcept("widgets/gizmo", { type: "concept", title: "Gizmo" }, "v1");

      await fns.updateConcept("widgets/gizmo", { body: "v2" });
      expect((await fns.readConcept("widgets/gizmo")).body).toBe("v2");
      expect((await fns.readConcept("widgets/gizmo")).state.title).toBe("Gizmo");

      await fns.updateConcept("widgets/gizmo", { state: { title: "Gizmo Pro" } });
      const after = await fns.readConcept("widgets/gizmo");
      expect(after.state.title).toBe("Gizmo Pro");
      expect(after.body).toBe("v2");
    });

    it("throws updating a missing concept", async () => {
      const collection = await makeConceptCollection();
      const { fns } = wire(collection);
      await expect(fns.updateConcept("nope", { body: "x" })).rejects.toThrow(/not found/);
    });

    it("rejects an update whose merged state fails schema validation", async () => {
      const collection = await makeConceptCollection();
      const { fns } = wire(collection);
      await fns.createConcept("widgets/gizmo", { type: "concept" }, "v1");

      await expect(
        fns.updateConcept("widgets/gizmo", { state: { type: null as unknown as string } }),
      ).rejects.toThrow();
      // The rejected update must not have persisted a malformed state.
      expect((await fns.readConcept("widgets/gizmo")).state.type).toBe("concept");
    });

    it("deletes only the target concept — siblings survive", async () => {
      const collection = await makeConceptCollection();
      const { fns } = wire(collection);
      await fns.createConcept("widgets/a", { type: "concept" }, "a");
      await fns.createConcept("widgets/b", { type: "concept" }, "b");

      await fns.deleteConcept("widgets/a");
      expect(await fns.readConcept("widgets/a")).toBeNull();
      expect((await fns.readConcept("widgets/b")).body).toBe("b");
    });

    it("delete is a no-op on a missing id", async () => {
      const collection = await makeConceptCollection();
      const { fns } = wire(collection);
      await expect(fns.deleteConcept("nope")).resolves.toBeUndefined();
    });
  });

  it("the index preset injects a <knowledge> progressive-disclosure listing", async () => {
    const collection = await makeConceptCollection();
    const { cap, ctx, fns } = wire(collection);
    await fns.importBundle(FIXTURE_BUNDLE);

    const out = await cap.__presetDefs.index.context(undefined, ctx);
    expect(out.knowledge).toContain("Concepts in the knowledge base");
    expect(out.knowledge).toContain("tables/orders");
  });

  it("the index preset renders nothing for an empty knowledge base", async () => {
    const collection = await makeConceptCollection();
    const { cap, ctx } = wire(collection);
    expect(await cap.__presetDefs.index.context(undefined, ctx)).toBeNull();
  });

  it("the search preset exposes the glob/grep/search nav tools plus content read", () => {
    const cap = createKnowledgeBaseCapability() as any;
    const tools = cap.__presetDefs.search.tools();
    expect(tools.map((t: { name: string }) => t.name).sort()).toEqual([
      "globResources",
      "grepResourceContent",
      "readResourceContent",
      "searchResources",
    ]);
  });
});
