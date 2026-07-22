import { describe, expect, it } from "vitest";
import { createSkillsCapability } from "../../src/skills/capability";
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
  it("returns a branded capability with the documented presets", () => {
    const cap = createSkillsCapability();
    expect(cap.__brand).toBe("Capability");
    expect(cap.name).toBe("skills");
    expect(cap.__presetDefs?.default).toEqual(["tools", "context", "runSkill"]);
    expect(cap.__presetDefs?.tools).toBeDefined();
    expect(cap.__presetDefs?.context).toBeDefined();
    expect(cap.__presetDefs?.runSkill).toBeDefined();
  });

  it("registers the skills collection at the org scope by default", () => {
    const cap = createSkillsCapability();
    const skillsRef = cap.resources?.skills;
    expect(skillsRef).toBeDefined();
    // Collection's intrinsic scope reflects where the resource state lives.
    expect((skillsRef as { scope?: string }).scope).toBe("org");
  });

  it("supports session and user scope override", () => {
    const sCap = createSkillsCapability({ scope: "session" });
    expect((sCap.resources?.skills as { scope?: string }).scope).toBe("session");
    const uCap = createSkillsCapability({ scope: "user" });
    expect((uCap.resources?.skills as { scope?: string }).scope).toBe("user");
  });

  it("`tools` preset carries only catalog tools — runSkill lives in its own preset", () => {
    const cap = createSkillsCapability({ catalog: { stubTool } });
    const toolsPreset = cap.__presetDefs?.tools as { tools: { name: string }[] };
    const names = toolsPreset.tools.map((t) => t.name);
    expect(names).toContain("stubTool");
    expect(names).not.toContain("runSkill");
  });

  it("`runSkill` preset carries the runSkill tool and the catalog context formatter", () => {
    const cap = createSkillsCapability({ catalog: { stubTool } });
    const preset = cap.__presetDefs?.runSkill as {
      tools: { name: string }[];
      context: { skills: unknown[] };
    };
    expect(preset.tools.map((t) => t.name)).toEqual(["runSkill"]);
    expect(preset.context.skills).toHaveLength(1);
  });

  it("`context` preset carries the active-skills formatter regardless of activation path", () => {
    const cap = createSkillsCapability({ catalog: { stubTool } });
    const preset = cap.__presetDefs?.context as {
      context: { skills: unknown[] };
    };
    expect(preset.context.skills).toHaveLength(1);
  });

  it("declares the active-skills session-state schema", () => {
    const cap = createSkillsCapability();
    expect(cap.sessionStateSchema).toBeDefined();
  });

  it("preset overrides via .presets() preserve base reference identity", () => {
    const cap = createSkillsCapability();
    const configured = cap.presets({ runSkill: false });
    // ConfiguredCapability sits on top of cap via Object.create
    expect(Object.getPrototypeOf(configured)).toBe(cap);
  });

  it("itemVisibility is unset by default (cap attaches to any block)", () => {
    const cap = createSkillsCapability();
    expect(cap.itemVisibility).toBeUndefined();
  });

  it("forwards itemVisibility to the defined capability", () => {
    const cap = createSkillsCapability({ itemVisibility: { client: true, history: true } });
    expect(cap.itemVisibility).toEqual({ client: true, history: true });

    const arrayCap = createSkillsCapability({
      itemVisibility: [
        { client: true, history: true },
        { client: false, history: false },
      ],
    });
    expect(arrayCap.itemVisibility).toEqual([
      { client: true, history: true },
      { client: false, history: false },
    ]);
  });

  it("does not auto-compose a delegation surface via `uses` (inline-only)", () => {
    const cap = createSkillsCapability();
    expect(cap.uses).toBeUndefined();
  });
});
