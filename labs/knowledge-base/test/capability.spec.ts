import { describe, it, expect } from "vitest";
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
    expect(await fns.readConcept("tables/orders")).toContain("# Schema");
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

  it("the search preset exposes the glob/grep/search nav tools", () => {
    const cap = createKnowledgeBaseCapability() as any;
    const tools = cap.__presetDefs.search.tools();
    expect(tools.map((t: { name: string }) => t.name).sort()).toEqual([
      "globResources",
      "grepResourceContent",
      "searchResources",
    ]);
  });
});
