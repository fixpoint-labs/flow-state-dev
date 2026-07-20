import { describe, expect, it } from "vitest";
import {
  createSkillActivator,
  matchedSkillSchema,
  skillActivationSourceSchema,
} from "../../src/skills";

describe("skillActivator — public schemas", () => {
  it("skillActivationSourceSchema enumerates the four origin tiers", () => {
    expect(skillActivationSourceSchema.options).toEqual([
      "slash",
      "keyword",
      "classifier",
      "manual-override",
    ]);
  });

  it("matchedSkillSchema requires name + source; defaults input", () => {
    const matched = matchedSkillSchema.parse({
      name: "linear",
      source: "slash",
    });
    expect(matched.input).toBe("");
    expect(matched.confidence).toBeUndefined();
  });
});

describe("createSkillActivator", () => {
  it("returns a sequencer block named 'skill-activator' by default", () => {
    const block = createSkillActivator();
    expect(block.kind).toBe("sequencer");
    expect(block.name).toBe("skill-activator");
  });

  it("respects the name override", () => {
    const block = createSkillActivator({ name: "my-activator" });
    expect(block.name).toBe("my-activator");
  });

  it("constructs cleanly with the LLM tier enabled (default)", () => {
    expect(() => createSkillActivator()).not.toThrow();
  });

  it("constructs cleanly with the LLM tier disabled", () => {
    expect(() =>
      createSkillActivator({ enableLlmClassifier: false }),
    ).not.toThrow();
  });
});
