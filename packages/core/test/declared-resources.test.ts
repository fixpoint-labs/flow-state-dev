import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler, generator, router, sequencer } from "../src";
import { defineResource } from "../src/types/resource";
import { extractDeclaredResources, mergeDeclaredResources } from "../src/blocks/internal/build-block";
import { createMockContext } from "./helpers";

const observationsResource = defineResource({
  stateSchema: z.object({
    entries: z.array(z.object({ text: z.string(), score: z.number() }))
  })
});

const artifactsResource = defineResource({
  stateSchema: z.object({
    order: z.array(z.string()),
    byId: z.record(z.object({ title: z.string() }))
  })
});

describe("extractDeclaredResources", () => {
  it("returns undefined when no resources are declared", () => {
    expect(extractDeclaredResources({})).toBeUndefined();
  });

  it("extracts sessionResources", () => {
    const result = extractDeclaredResources({
      sessionResources: { observations: observationsResource }
    });
    expect(result).toEqual({
      session: { observations: observationsResource }
    });
  });

  it("extracts userResources", () => {
    const result = extractDeclaredResources({
      userResources: { artifacts: artifactsResource }
    });
    expect(result).toEqual({
      user: { artifacts: artifactsResource }
    });
  });

  it("extracts orgResources", () => {
    const result = extractDeclaredResources({
      orgResources: { artifacts: artifactsResource }
    });
    expect(result).toEqual({
      org: { artifacts: artifactsResource }
    });
  });

  it("extracts multiple scopes", () => {
    const result = extractDeclaredResources({
      sessionResources: { observations: observationsResource },
      userResources: { artifacts: artifactsResource },
      orgResources: { artifacts: artifactsResource }
    });
    expect(result).toEqual({
      session: { observations: observationsResource },
      user: { artifacts: artifactsResource },
      org: { artifacts: artifactsResource }
    });
  });
});

describe("handler declaredResources", () => {
  it("surfaces declaredResources from sessionResources", () => {
    const block = handler({
      name: "with-resources",
      inputSchema: z.string(),
      outputSchema: z.string(),
      sessionResources: { observations: observationsResource },
      execute: (input) => input
    });

    expect(block.declaredResources).toEqual({
      session: { observations: observationsResource }
    });
  });

  it("surfaces declaredResources from multiple scopes", () => {
    const block = handler({
      name: "multi-scope",
      inputSchema: z.string(),
      outputSchema: z.string(),
      sessionResources: { observations: observationsResource },
      userResources: { artifacts: artifactsResource },
      execute: (input) => input
    });

    expect(block.declaredResources).toEqual({
      session: { observations: observationsResource },
      user: { artifacts: artifactsResource }
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
      sessionResources: { observations: observationsResource },
      execute: (input) => `processed:${input}`
    });

    const ctx = createMockContext();
    await expect(block.run("test", ctx)).resolves.toBe("processed:test");
  });
});

describe("generator declaredResources", () => {
  it("surfaces declaredResources from sessionResources", () => {
    const block = generator({
      name: "gen-with-resources",
      inputSchema: z.string(),
      outputSchema: z.string(),
      sessionResources: { observations: observationsResource },
      model: "demo-model",
      prompt: "test"
    });

    expect(block.declaredResources).toEqual({
      session: { observations: observationsResource }
    });
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
  it("surfaces declaredResources from sessionResources", () => {
    const routeA = handler({
      name: "route-a",
      execute: () => "a"
    });

    const block = router({
      name: "router-with-resources",
      sessionResources: { observations: observationsResource },
      routes: [routeA],
      execute: () => routeA
    });

    expect(block.declaredResources).toEqual({
      session: { observations: observationsResource }
    });
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
    const target = { session: { observations: observationsResource } };
    expect(mergeDeclaredResources(target, undefined)).toBe(target);
  });

  it("returns copy of source when target is undefined", () => {
    const source = { session: { observations: observationsResource } };
    const result = mergeDeclaredResources(undefined, source);
    expect(result).toEqual(source);
    expect(result).not.toBe(source);
  });

  it("merges disjoint scopes", () => {
    const target = { session: { observations: observationsResource } };
    const source = { user: { artifacts: artifactsResource } };
    const result = mergeDeclaredResources(target, source);
    expect(result).toEqual({
      session: { observations: observationsResource },
      user: { artifacts: artifactsResource }
    });
  });

  it("merges disjoint resources in the same scope", () => {
    const target = { session: { observations: observationsResource } };
    const source = { session: { artifacts: artifactsResource } };
    const result = mergeDeclaredResources(target, source);
    expect(result).toEqual({
      session: { observations: observationsResource, artifacts: artifactsResource }
    });
  });

  it("allows same resource reference in same scope (no conflict)", () => {
    const target = { session: { observations: observationsResource } };
    const source = { session: { observations: observationsResource } };
    expect(() => mergeDeclaredResources(target, source)).not.toThrow();
    const result = mergeDeclaredResources(target, source);
    expect(result).toEqual({
      session: { observations: observationsResource }
    });
  });

  it("throws on different resource references with same name", () => {
    const otherObservations = defineResource({
      stateSchema: z.object({ items: z.array(z.string()) })
    });
    const target = { session: { observations: observationsResource } };
    const source = { session: { observations: otherObservations } };
    expect(() => mergeDeclaredResources(target, source)).toThrow("Resource conflict");
  });
});

// --- Sequencer resource collection ---

const notesResource = defineResource({
  stateSchema: z.object({ items: z.array(z.string()) })
});

describe("sequencer resource collection", () => {
  it("has undefined declaredResources when no child blocks declare resources", () => {
    const noResBlock = handler({ name: "plain", execute: (v) => v });
    const seq = sequencer({ name: "no-res" }).then(noResBlock);
    expect(seq.declaredResources).toBeUndefined();
  });

  it("collects resources from a single .then() block", () => {
    const block = handler({
      name: "step",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "single-then" }).then(block);
    expect(seq.declaredResources).toEqual({
      session: { observations: observationsResource }
    });
  });

  it("merges resources from multiple .then() blocks", () => {
    const blockA = handler({
      name: "a",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const blockB = handler({
      name: "b",
      userResources: { artifacts: artifactsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "multi-then" }).then(blockA).then(blockB);
    expect(seq.declaredResources).toEqual({
      session: { observations: observationsResource },
      user: { artifacts: artifactsResource }
    });
  });

  it("merges resources within the same scope across blocks", () => {
    const blockA = handler({
      name: "a",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const blockB = handler({
      name: "b",
      sessionResources: { notes: notesResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "same-scope" }).then(blockA).then(blockB);
    expect(seq.declaredResources).toEqual({
      session: { observations: observationsResource, notes: notesResource }
    });
  });

  it("allows duplicate same-reference resources across blocks", () => {
    const blockA = handler({
      name: "a",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const blockB = handler({
      name: "b",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "dup-ok" }).then(blockA).then(blockB);
    expect(seq.declaredResources).toEqual({
      session: { observations: observationsResource }
    });
  });

  it("throws on conflicting resource references", () => {
    const otherObservations = defineResource({
      stateSchema: z.object({ items: z.array(z.string()) })
    });
    const blockA = handler({
      name: "a",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const blockB = handler({
      name: "b",
      sessionResources: { observations: otherObservations },
      execute: (v) => v
    });
    expect(() => sequencer({ name: "conflict" }).then(blockA).then(blockB)).toThrow("Resource conflict");
  });

  it("collects resources from .thenIf()", () => {
    const block = handler({
      name: "cond",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "then-if" }).thenIf(() => true, block);
    expect(seq.declaredResources).toEqual({
      session: { observations: observationsResource }
    });
  });

  it("collects resources from .parallel() steps", () => {
    const blockA = handler({
      name: "a",
      sessionResources: { observations: observationsResource },
      outputSchema: z.string(),
      execute: () => "a"
    });
    const blockB = handler({
      name: "b",
      userResources: { artifacts: artifactsResource },
      outputSchema: z.number(),
      execute: () => 1
    });
    const seq = sequencer({ name: "par" }).parallel({ a: blockA, b: blockB });
    expect(seq.declaredResources).toEqual({
      session: { observations: observationsResource },
      user: { artifacts: artifactsResource }
    });
  });

  it("collects resources from .forEach()", () => {
    const block = handler({
      name: "each",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "for-each", inputSchema: z.array(z.string()) }).forEach(block);
    expect(seq.declaredResources).toEqual({
      session: { observations: observationsResource }
    });
  });

  it("collects resources from .doUntil()", () => {
    const block = handler({
      name: "loop",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "do-until" }).doUntil(() => true, block);
    expect(seq.declaredResources).toEqual({
      session: { observations: observationsResource }
    });
  });

  it("collects resources from .doWhile()", () => {
    const block = handler({
      name: "loop",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "do-while" }).doWhile(() => false, block);
    expect(seq.declaredResources).toEqual({
      session: { observations: observationsResource }
    });
  });

  it("collects resources from .work()", () => {
    const block = handler({
      name: "bg",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "work" }).work(block);
    expect(seq.declaredResources).toEqual({
      session: { observations: observationsResource }
    });
  });

  it("collects resources from .tap() with a block", () => {
    const block = handler({
      name: "side",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "tap" }).tap(block);
    expect(seq.declaredResources).toEqual({
      session: { observations: observationsResource }
    });
  });

  it("collects resources from .tapIf() with a block", () => {
    const block = handler({
      name: "cond-side",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "tap-if" }).tapIf(() => true, block);
    expect(seq.declaredResources).toEqual({
      session: { observations: observationsResource }
    });
  });

  it("collects resources from .rescue() handler blocks", () => {
    const rescueBlock = handler({
      name: "rescue",
      sessionResources: { observations: observationsResource },
      execute: () => "recovered"
    });
    const seq = sequencer({ name: "rescue-seq" }).rescue([{ block: rescueBlock }]);
    expect(seq.declaredResources).toEqual({
      session: { observations: observationsResource }
    });
  });

  it("collects resources from .branch() blocks", () => {
    const branchBlock = handler({
      name: "route",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const seq = sequencer({ name: "branch-seq" }).branch({
      a: [(v) => v, () => true, branchBlock]
    });
    expect(seq.declaredResources).toEqual({
      session: { observations: observationsResource }
    });
  });

  it("bubbles resources from nested sequencers", () => {
    const block = handler({
      name: "inner-step",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const inner = sequencer({ name: "inner" }).then(block);
    expect(inner.declaredResources).toEqual({
      session: { observations: observationsResource }
    });

    const outer = sequencer({ name: "outer" }).then(inner);
    expect(outer.declaredResources).toEqual({
      session: { observations: observationsResource }
    });
  });

  it("bubbles and merges resources from deeply nested sequencers", () => {
    const blockA = handler({
      name: "a",
      sessionResources: { observations: observationsResource },
      execute: (v) => v
    });
    const blockB = handler({
      name: "b",
      userResources: { artifacts: artifactsResource },
      execute: (v) => v
    });

    const inner = sequencer({ name: "inner" }).then(blockA);
    const outer = sequencer({ name: "outer" }).then(inner).then(blockB);

    expect(outer.declaredResources).toEqual({
      session: { observations: observationsResource },
      user: { artifacts: artifactsResource }
    });
  });

  it("still executes correctly with resource collection", async () => {
    const blockA = handler({
      name: "a",
      sessionResources: { observations: observationsResource },
      execute: (v: number) => v + 1
    });
    const blockB = handler({
      name: "b",
      userResources: { artifacts: artifactsResource },
      execute: (v: number) => v * 2
    });

    const seq = sequencer({ name: "exec-test", inputSchema: z.number() })
      .then(blockA)
      .then(blockB);

    const ctx = createMockContext();
    await expect(seq.run(5, ctx)).resolves.toBe(12);
    expect(seq.declaredResources).toEqual({
      session: { observations: observationsResource },
      user: { artifacts: artifactsResource }
    });
  });
});
