import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler, generator, router } from "../src";
import { defineResource } from "../src/types/resource";
import { extractDeclaredResources } from "../src/blocks/internal/build-block";
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

  it("extracts projectResources", () => {
    const result = extractDeclaredResources({
      projectResources: { artifacts: artifactsResource }
    });
    expect(result).toEqual({
      project: { artifacts: artifactsResource }
    });
  });

  it("extracts multiple scopes", () => {
    const result = extractDeclaredResources({
      sessionResources: { observations: observationsResource },
      userResources: { artifacts: artifactsResource },
      projectResources: { artifacts: artifactsResource }
    });
    expect(result).toEqual({
      session: { observations: observationsResource },
      user: { artifacts: artifactsResource },
      project: { artifacts: artifactsResource }
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
