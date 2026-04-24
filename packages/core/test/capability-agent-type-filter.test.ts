/**
 * Tests for the capability agentType filter.
 *
 * A capability declaring `agentType` (single or array) is only attached to
 * blocks whose agentType is in the allowlist. A block with no agentType is
 * treated as "primary" — the default identity for un-tagged generators and
 * all non-generator block kinds.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineCapability } from "../src/capability";
import { defineResource } from "../src/types/resource";
import { generator } from "../src/blocks/generator";
import { handler } from "../src/blocks/handler";

const resourceA = defineResource({ stateSchema: z.object({ a: z.string() }) });
const resourceB = defineResource({ stateSchema: z.object({ b: z.string() }) });

describe("capability agentType filter", () => {
  it("unscoped capability (no agentType) attaches to any block identity", () => {
    const cap = defineCapability({
      name: "shared",
      sessionResources: { resourceA },
    });

    const primary = generator({
      name: "primary-gen",
      uses: [cap],
      agentType: "primary",
      model: "preset/fast",
      prompt: "x",
    });
    const sub = generator({
      name: "sub-gen",
      uses: [cap],
      agentType: "sub",
      model: "preset/fast",
      prompt: "x",
    });
    const untagged = generator({
      name: "untagged-gen",
      uses: [cap],
      model: "preset/fast",
      prompt: "x",
    });

    expect(primary.declaredResources?.session?.resourceA).toBe(resourceA);
    expect(sub.declaredResources?.session?.resourceA).toBe(resourceA);
    expect(untagged.declaredResources?.session?.resourceA).toBe(resourceA);
  });

  it("agentType: 'primary' excludes sub-agent generators", () => {
    const cap = defineCapability({
      name: "main-only",
      sessionResources: { resourceA },
      agentType: "primary",
    });

    const primary = generator({
      name: "primary-gen",
      uses: [cap],
      agentType: "primary",
      model: "preset/fast",
      prompt: "x",
    });
    const sub = generator({
      name: "sub-gen",
      uses: [cap],
      agentType: "sub",
      model: "preset/fast",
      prompt: "x",
    });

    expect(primary.declaredResources?.session?.resourceA).toBe(resourceA);
    expect(sub.declaredResources?.session?.resourceA).toBeUndefined();
  });

  it("unset block agentType is treated as 'primary' for filter purposes", () => {
    const cap = defineCapability({
      name: "main-only",
      sessionResources: { resourceA },
      agentType: "primary",
    });

    const gen = generator({
      name: "untagged-gen",
      uses: [cap],
      model: "preset/fast",
      prompt: "x",
    });

    expect(gen.declaredResources?.session?.resourceA).toBe(resourceA);
  });

  it("allowlist array matches any listed agentType", () => {
    const cap = defineCapability({
      name: "primary-or-trace",
      sessionResources: { resourceA },
      agentType: ["primary", "trace"],
    });

    const primary = generator({
      name: "p",
      uses: [cap],
      agentType: "primary",
      model: "preset/fast",
      prompt: "x",
    });
    const trace = generator({
      name: "t",
      uses: [cap],
      agentType: "trace",
      model: "preset/fast",
      prompt: "x",
    });
    const sub = generator({
      name: "s",
      uses: [cap],
      agentType: "sub",
      model: "preset/fast",
      prompt: "x",
    });

    expect(primary.declaredResources?.session?.resourceA).toBe(resourceA);
    expect(trace.declaredResources?.session?.resourceA).toBe(resourceA);
    expect(sub.declaredResources?.session?.resourceA).toBeUndefined();
  });

  it("scoped capability's tools preset is excluded from sub-agents", () => {
    const skillTool = handler({
      name: "skillTool",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => ({}),
    });

    const cap = defineCapability({
      name: "skills-ish",
      agentType: "primary",
      presets: {
        tools: { tools: [skillTool] },
        default: ["tools"],
      },
    });

    const primary = generator({
      name: "primary-gen",
      uses: [cap],
      agentType: "primary",
      model: "preset/fast",
      prompt: "x",
    });
    const sub = generator({
      name: "sub-gen",
      uses: [cap],
      agentType: "sub",
      model: "preset/fast",
      prompt: "x",
    });

    // The resolvedCapabilities list — what merge passes into the generator
    // — should include the cap only on primary.
    const primaryCaps = (primary.config as any).__resolvedCapabilities as { name: string }[] | undefined;
    const subCaps = (sub.config as any).__resolvedCapabilities as { name: string }[] | undefined;
    expect(primaryCaps?.some((c) => c.name === "skills-ish")).toBe(true);
    expect(subCaps?.some((c) => c.name === "skills-ish") ?? false).toBe(false);
  });

  it("filter applies independently to sibling caps — unscoped cap still attaches", () => {
    const mainCap = defineCapability({
      name: "main-only",
      sessionResources: { resourceA },
      agentType: "primary",
    });
    const sharedCap = defineCapability({
      name: "shared",
      sessionResources: { resourceB },
    });

    const sub = generator({
      name: "sub-gen",
      uses: [mainCap, sharedCap],
      agentType: "sub",
      model: "preset/fast",
      prompt: "x",
    });

    expect(sub.declaredResources?.session?.resourceA).toBeUndefined();
    expect(sub.declaredResources?.session?.resourceB).toBe(resourceB);
  });

  it("handler treats unset block agentType as primary — scoped cap still attaches", () => {
    // Handlers don't have agentType. The filter treats this as "primary".
    const cap = defineCapability({
      name: "main-only",
      sessionResources: { resourceA },
      agentType: "primary",
    });

    const h = handler({
      name: "h",
      uses: [cap],
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => ({}),
    });

    expect(h.declaredResources?.session?.resourceA).toBe(resourceA);
  });
});
