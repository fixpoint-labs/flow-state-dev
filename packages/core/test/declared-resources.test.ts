import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler, generator, router, sequencer } from "../src";
import { defineResource } from "../src/types/resource";
import { extractDeclaredResources, mergeDeclaredResources } from "../src/blocks/internal/build-block";
import { createMockContext, runForTest } from "./helpers";
const observationsResource = defineResource({
  scope: "session",
  stateSchema: z.object({
    entries: z.array(z.object({ text: z.string(), score: z.number() }))
  })
});

const artifactsResource = defineResource({
  scope: "user",
  stateSchema: z.object({
    order: z.array(z.string()),
    byId: z.record(z.object({ title: z.string() }))
  })
});

const orgArtifactsResource = defineResource({
  scope: "org",
  stateSchema: z.object({
    order: z.array(z.string()),
    byId: z.record(z.object({ title: z.string() }))
  })
});

describe("extractDeclaredResources", () => {
  it("returns undefined when no resources are declared", () => {
    expect(extractDeclaredResources({})).toBeUndefined();
  });

  it("extracts session-scoped resources from flat resources map", () => {
    const result = extractDeclaredResources({
      resources: { observations: observationsResource }
    });
    expect(result).toEqual({ observations: observationsResource });
  });

  it("extracts user-scoped resources from flat resources map", () => {
    const result = extractDeclaredResources({
      resources: { artifacts: artifactsResource }
    });
    expect(result).toEqual({ artifacts: artifactsResource });
  });

  it("extracts org-scoped resources from flat resources map", () => {
    const result = extractDeclaredResources({
      resources: { orgArtifacts: orgArtifactsResource }
    });
    expect(result).toEqual({ orgArtifacts: orgArtifactsResource });
  });

  it("extracts a mix of scopes from a single flat map", () => {
    const result = extractDeclaredResources({
      resources: {
        observations: observationsResource,
        artifacts: artifactsResource,
        orgArtifacts: orgArtifactsResource
      }
    });
    expect(result).toEqual({
      observations: observationsResource,
      artifacts: artifactsResource,
      orgArtifacts: orgArtifactsResource
    });
  });
});

describe("handler declaredResources", () => {
  it("surfaces declaredResources from flat resources map", () => {
    const block = handler({
      name: "with-resources",
      inputSchema: z.string(),
      outputSchema: z.string(),
      resources: { observations: observationsResource },
      execute: (input) => input
    });

    expect(block.declaredResources).toEqual({ observations: observationsResource });
  });

  it("surfaces declaredResources from a multi-scope flat map", () => {
    const block = handler({
      name: "multi-scope",
      inputSchema: z.string(),
      outputSchema: z.string(),
      resources: {
        observations: observationsResource,
        artifacts: artifactsResource
      },
      execute: (input) => input
    });

    expect(block.declaredResources).toEqual({
      observations: observationsResource,
      artifacts: artifactsResource
    });
  });

  it("has undefined declaredResources when none are declared", () => {
    const block = handler({
      name: "no-resources",
      inputSchema: z.string(),
      outputSchema: z.string(),
      execute: (input) => input
    });

    expect(block.declaredResources).toBeUndefined();
  });

  it("still executes normally with declaredResources", async () => {
    const block = handler({
      name: "exec-with-resources",
      inputSchema: z.string(),
      outputSchema: z.string(),
      resources: { observations: observationsResource },
      execute: (input) => `processed:${input}`
    });

    const ctx = createMockContext();
    await expect(runForTest(block, "test", ctx)).resolves.toBe("processed:test");
  });
});

describe("generator declaredResources", () => {
  it("surfaces declaredResources from flat resources map", () => {
    const block = generator({
      name: "gen-with-resources",
      inputSchema: z.string(),
      outputSchema: z.string(),
      resources: { observations: observationsResource },
      model: "demo-model",
      prompt: "test"
    });

    expect(block.declaredResources).toEqual({ observations: observationsResource });
  });

  it("has undefined declaredResources when none are declared", () => {
    const block = generator({
      name: "gen-no-resources",
      inputSchema: z.string(),
      outputSchema: z.string(),
      model: "demo-model",
      prompt: "test"
    });

    expect(block.declaredResources).toBeUndefined();
  });
});

describe("router declaredResources", () => {
  it("surfaces declaredResources from flat resources map", () => {
    const routeA = handler({
      name: "route-a",
      execute: () => "a"
    });

    const block = router({
      name: "router-with-resources",
      resources: { observations: observationsResource },
      routes: [routeA],
      execute: () => routeA
    });

    expect(block.declaredResources).toEqual({ observations: observationsResource });
  });

  it("has undefined declaredResources when none are declared", () => {
    const routeA = handler({
      name: "route-a",
      execute: () => "a"
    });

    const block = router({
      name: "router-no-resources",
      routes: [routeA],
      execute: () => routeA
    });

    expect(block.declaredResources).toBeUndefined();
  });
});

// --- mergeDeclaredResources ---

describe("mergeDeclaredResources", () => {
  it("returns undefined when both are undefined", () => {
    expect(mergeDeclaredResources(undefined, undefined)).toBeUndefined();
  });

  it("returns target when source is undefined", () => {
    const target = { observations: observationsResource };
    expect(mergeDeclaredResources(target, undefined)).toBe(target);
  });

  it("returns copy of source when target is undefined", () => {
    const source = { observations: observationsResource };
    const result = mergeDeclaredResources(undefined, source);
    expect(result).toEqual(source);
    expect(result).not.toBe(source);
  });

  it("merges disjoint accessor keys across scopes", () => {
    const target = { observations: observationsResource };
    const source = { artifacts: artifactsResource };
    const result = mergeDeclaredResources(target, source);
    expect(result).toEqual({
      observations: observationsResource,
      artifacts: artifactsResource
    });
  });

  it("merges disjoint accessor keys within the same scope", () => {
    const notesResource = defineResource({
      scope: "session",
      stateSchema: z.object({ items: z.array(z.string()) })
    });
    const target = { observations: observationsResource };
    const source = { notes: notesResource };
    const result = mergeDeclaredResources(target, source);
    expect(result).toEqual({
      observations: observationsResource,
      notes: notesResource
    });
  });

  it("allows same resource reference under the same accessor (no conflict)", () => {
    const target = { observations: observationsResource };
    const source = { observations: observationsResource };
    expect(() => mergeDeclaredResources(target, source)).not.toThrow();
    const result = mergeDeclaredResources(target, source);
    expect(result).toEqual({ observations: observationsResource });
  });

  it("throws on different resource references with same accessor", () => {
    const otherObservations = defineResource({
      scope: "session",
      stateSchema: z.object({ items: z.array(z.string()) })
    });
    const target = { observations: observationsResource };
    const source = { observations: otherObservations };
    expect(() => mergeDeclaredResources(target, source)).toThrow("Resource conflict");
  });
});

// --- Sequencer resource collection ---

const notesResource = defineResource({
  scope: "session",
  stateSchema: z.object({ items: z.array(z.string()) })
});

describe("sequencer resource collection", () => {
  it("has undefined declaredResources when no child blocks declare resources", () => {
    const noResBlock = handler({ name: "plain", execute: (v) => v });
    const seq = sequencer({ name: "no-res" }).step(noResBlock);
    expect(seq.declaredResources).toBeUndefined();
  });

  it("collects resources from a single .step() block", () => {
    const block = handler({
      name: "step",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "single-then" }).step(block);
    expect(seq.declaredResources).toEqual({ observations: observationsResource });
  });

  it("merges resources from multiple .step() blocks", () => {
    const blockA = handler({
      name: "a",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const blockB = handler({
      name: "b",
      resources: { artifacts: artifactsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "multi-then" }).step(blockA).step(blockB);
    expect(seq.declaredResources).toEqual({
      observations: observationsResource,
      artifacts: artifactsResource
    });
  });

  it("merges disjoint session-scoped resources across blocks", () => {
    const blockA = handler({
      name: "a",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const blockB = handler({
      name: "b",
      resources: { notes: notesResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "same-scope" }).step(blockA).step(blockB);
    expect(seq.declaredResources).toEqual({
      observations: observationsResource,
      notes: notesResource
    });
  });

  it("allows duplicate same-reference resources across blocks", () => {
    const blockA = handler({
      name: "a",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const blockB = handler({
      name: "b",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "dup-ok" }).step(blockA).step(blockB);
    expect(seq.declaredResources).toEqual({ observations: observationsResource });
  });

  it("throws on conflicting resource references", () => {
    const otherObservations = defineResource({
      scope: "session",
      stateSchema: z.object({ items: z.array(z.string()) })
    });
    const blockA = handler({
      name: "a",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const blockB = handler({
      name: "b",
      resources: { observations: otherObservations },
      execute: (v) => v
    });
    expect(() => sequencer({ name: "conflict" }).step(blockA).step(blockB)).toThrow("Resource conflict");
  });

  it("collects resources from .stepIf()", () => {
    const block = handler({
      name: "cond",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "then-if" }).stepIf(() => true, block);
    expect(seq.declaredResources).toEqual({ observations: observationsResource });
  });

  it("collects resources from .parallel() steps", () => {
    const blockA = handler({
      name: "a",
      resources: { observations: observationsResource },
      outputSchema: z.string(),
      execute: () => "a"
    });
    const blockB = handler({
      name: "b",
      resources: { artifacts: artifactsResource },
      outputSchema: z.number(),
      execute: () => 1
    });
    const seq = sequencer({ name: "par" }).parallel({ a: blockA, b: blockB });
    expect(seq.declaredResources).toEqual({
      observations: observationsResource,
      artifacts: artifactsResource
    });
  });

  it("collects resources from .forEach()", () => {
    const block = handler({
      name: "each",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "for-each", inputSchema: z.array(z.string()) }).forEach(block);
    expect(seq.declaredResources).toEqual({ observations: observationsResource });
  });

  it("collects resources from .doUntil()", () => {
    const block = handler({
      name: "loop",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "do-until" }).doUntil(() => true, block);
    expect(seq.declaredResources).toEqual({ observations: observationsResource });
  });

  it("collects resources from .doWhile()", () => {
    const block = handler({
      name: "loop",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "do-while" }).doWhile(() => false, block);
    expect(seq.declaredResources).toEqual({ observations: observationsResource });
  });

  it("collects resources from .work()", () => {
    const block = handler({
      name: "bg",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "work" }).work(block);
    expect(seq.declaredResources).toEqual({ observations: observationsResource });
  });

  it("collects resources from .tap() with a block", () => {
    const block = handler({
      name: "side",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "tap" }).tap(block);
    expect(seq.declaredResources).toEqual({ observations: observationsResource });
  });

  it("collects resources from .tapIf() with a block", () => {
    const block = handler({
      name: "cond-side",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "tap-if" }).tapIf(() => true, block);
    expect(seq.declaredResources).toEqual({ observations: observationsResource });
  });

  it("collects resources from .rescue() handler blocks", () => {
    const rescueBlock = handler({
      name: "rescue",
      resources: { observations: observationsResource },
      execute: () => "recovered"
    });
    const seq = sequencer({ name: "rescue-seq" }).rescue([{ block: rescueBlock }]);
    expect(seq.declaredResources).toEqual({ observations: observationsResource });
  });

  it("collects resources from .branch() blocks", () => {
    const branchBlock = handler({
      name: "route",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "branch-seq" }).branch({
      a: [(v) => v, () => true, branchBlock]
    });
    expect(seq.declaredResources).toEqual({ observations: observationsResource });
  });

  it("bubbles resources from nested sequencers", () => {
    const block = handler({
      name: "inner-step",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const inner = sequencer({ name: "inner" }).step(block);
    expect(inner.declaredResources).toEqual({ observations: observationsResource });

    const outer = sequencer({ name: "outer" }).step(inner);
    expect(outer.declaredResources).toEqual({ observations: observationsResource });
  });

  it("bubbles and merges resources from deeply nested sequencers", () => {
    const blockA = handler({
      name: "a",
      resources: { observations: observationsResource },
      execute: (v) => v
    });
    const blockB = handler({
      name: "b",
      resources: { artifacts: artifactsResource },
      execute: (v) => v
    });

    const inner = sequencer({ name: "inner" }).step(blockA);
    const outer = sequencer({ name: "outer" }).step(inner).step(blockB);

    expect(outer.declaredResources).toEqual({
      observations: observationsResource,
      artifacts: artifactsResource
    });
  });

  it("still executes correctly with resource collection", async () => {
    const blockA = handler({
      name: "a",
      resources: { observations: observationsResource },
      execute: (v: number) => v + 1
    });
    const blockB = handler({
      name: "b",
      resources: { artifacts: artifactsResource },
      execute: (v: number) => v * 2
    });

    const seq = sequencer({ name: "exec-test", inputSchema: z.number() })
      .step(blockA)
      .step(blockB);

    const ctx = createMockContext();
    await expect(runForTest(seq, 5, ctx)).resolves.toBe(12);
    expect(seq.declaredResources).toEqual({
      observations: observationsResource,
      artifacts: artifactsResource
    });
  });
});
