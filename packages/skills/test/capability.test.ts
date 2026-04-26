import { describe, expect, it } from "vitest";
import { createSkillsCapability } from "../src/capability";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const stubTool = handler({
  name: "stubTool",
  description: "A stub for catalog wiring tests",
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: async () => ({}),
});

describe("createSkillsCapability", () => {
  it("returns a branded capability with default presets", () => {
    const cap = createSkillsCapability();
    expect(cap.__brand).toBe("Capability");
    expect(cap.name).toBe("skills");
    expect(cap.__presetDefs?.default).toEqual(["tools", "context"]);
    expect(cap.__presetDefs?.tools).toBeDefined();
    expect(cap.__presetDefs?.context).toBeDefined();
  });

  it("registers the skills collection at the org scope by default", () => {
    const cap = createSkillsCapability();
    expect(cap.orgResources?.skills).toBeDefined();
    expect(cap.sessionResources).toBeUndefined();
    expect(cap.userResources).toBeUndefined();
  });

  it("supports session and user scope override", () => {
    const sCap = createSkillsCapability({ scope: "session" });
    expect(sCap.sessionResources?.skills).toBeDefined();
    const uCap = createSkillsCapability({ scope: "user" });
    expect(uCap.userResources?.skills).toBeDefined();
  });

  it("includes runSkill plus all catalog tools in the tools preset", () => {
    const cap = createSkillsCapability({
      catalog: { stubTool },
    });
    const tools = (cap.__presetDefs?.tools as { tools: { name: string }[] }).tools;
    const names = tools.map((t) => t.name);
    expect(names).toContain("runSkill");
    expect(names).toContain("stubTool");
  });

  it("declares the active-skills session-state schema", () => {
    const cap = createSkillsCapability();
    expect(cap.sessionStateSchema).toBeDefined();
  });

  it("preset overrides via .presets() preserve base reference identity", () => {
    const cap = createSkillsCapability();
    const configured = cap.presets({ tools: false });
    // ConfiguredCapability sits on top of cap via Object.create
    expect(Object.getPrototypeOf(configured)).toBe(cap);
  });

  it("agentType is unset by default (cap attaches to any block)", () => {
    const cap = createSkillsCapability();
    expect(cap.agentType).toBeUndefined();
  });

  it("forwards agentType to the defined capability", () => {
    const cap = createSkillsCapability({ agentType: "primary" });
    expect(cap.agentType).toBe("primary");

    const arrayCap = createSkillsCapability({ agentType: ["primary", "trace"] });
    expect(arrayCap.agentType).toEqual(["primary", "trace"]);
  });
});
