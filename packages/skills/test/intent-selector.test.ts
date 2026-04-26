import { describe, expect, it } from "vitest";
import {
  createIntentSelector,
  intentSourceSchema,
  matchedSkillSchema,
  intentResultSchema,
} from "../src";

describe("intentSelector — public schemas", () => {
  it("intentSourceSchema enumerates the four origin tiers", () => {
    expect(intentSourceSchema.options).toEqual([
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

  it("intentResultSchema requires activeSkills + intentSource", () => {
    const intent = intentResultSchema.parse({
      activeSkills: [],
      intentSource: "classifier",
    });
    expect(intent.activeSkills).toEqual([]);
    expect(intent.intentSource).toBe("classifier");
  });
});

describe("createIntentSelector", () => {
  it("returns a sequencer block named 'intent-selector' by default", () => {
    const block = createIntentSelector();
    expect(block.kind).toBe("sequencer");
    expect(block.name).toBe("intent-selector");
  });

  it("respects the name override", () => {
    const block = createIntentSelector({ name: "my-selector" });
    expect(block.name).toBe("my-selector");
  });

  it("constructs cleanly with the LLM tier enabled (default)", () => {
    expect(() => createIntentSelector()).not.toThrow();
  });

  it("constructs cleanly with the LLM tier disabled", () => {
    expect(() =>
      createIntentSelector({ enableLlmClassifier: false }),
    ).not.toThrow();
  });
});
