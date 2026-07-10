import { describe, it, expect } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { createKnowledgeBaseCapability } from "../src/capability";
import { makeConceptCollection } from "./helpers";

/** Build the capability and a minimal ctx whose `resources.concepts` is a real collection. */
function wire(collection: Awaited<ReturnType<typeof makeConceptCollection>>) {
  const cap = createKnowledgeBaseCapability() as any;
  return cap.fns({ resources: { concepts: collection } });
}

describe("concept collection user-scope isolation", () => {
  it("two userIds see isolated corpora over the same store", async () => {
    const stores = createInMemoryStores();
    const owner = wire(await makeConceptCollection("owner", stores));
    const owner2 = wire(await makeConceptCollection("owner2", stores));

    await owner.createConcept("widgets/gizmo", { type: "concept" }, "owner's body");

    expect(await owner.readConcept("widgets/gizmo")).not.toBeNull();
    expect(await owner2.readConcept("widgets/gizmo")).toBeNull();
    expect(await owner2.listConcepts()).toEqual([]);
  });

  it("the same userId across separate collection instances (stateless calls) shares the corpus", async () => {
    const stores = createInMemoryStores();
    const callA = wire(await makeConceptCollection("owner", stores));
    await callA.createConcept("widgets/gizmo", { type: "concept" }, "written in call A");

    const callB = wire(await makeConceptCollection("owner", stores));
    const read = await callB.readConcept("widgets/gizmo");
    expect(read?.body).toBe("written in call A");
  });
});
