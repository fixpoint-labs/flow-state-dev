import { describe, expect, it } from "vitest";
import { handler } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  createSkillActivator,
  matchedSkillSchema,
  skillActivationSourceSchema,
} from "../../src/skills";
import { skillActivatorStateSchema } from "../../src/skills/skill-activation-types";

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

  it("constructs cleanly with an injected classifier", () => {
    const classifier = handler({
      name: "injected-classifier",
      inputSchema: z.object({ message: z.string() }).passthrough(),
      outputSchema: z.object({ used: z.literal(true) }),
      execute: () => ({ used: true as const }),
    });
    expect(() => createSkillActivator({ classifier })).not.toThrow();
  });

  it("runs the injected classifier when slash and keyword are inconclusive", async () => {
    let ran = 0;
    const classifier = handler({
      name: "injected-classifier",
      inputSchema: z.object({ message: z.string() }).passthrough(),
      outputSchema: z.object({ used: z.literal(true) }),
      sequencerStateSchema: skillActivatorStateSchema,
      execute: async (_input, ctx) => {
        ran += 1;
        await ctx.sequencer!.patchState({
          resolved: true,
          skills: [
            {
              name: "injected",
              input: "",
              source: "classifier" as const,
              confidence: 0.9,
            },
          ],
          classifierConfidence: 0.9,
        });
        return { used: true as const };
      },
    });

    const block = createSkillActivator({
      classifier,
      enableKeywordMatch: false,
    });
    const result = await testBlock(block, {
      input: { message: "please handle this" },
    });
    expect(result.error).toBeNull();
    expect(ran).toBe(1);
    expect(result.state.session.activeSkills).toEqual([
      expect.objectContaining({ name: "injected", source: "classifier" }),
    ]);
  });

  it("skips an injected classifier when enableLlmClassifier is false", async () => {
    let ran = 0;
    const classifier = handler({
      name: "injected-classifier",
      inputSchema: z.object({ message: z.string() }).passthrough(),
      outputSchema: z.object({ used: z.literal(true) }),
      execute: () => {
        ran += 1;
        return { used: true as const };
      },
    });

    const block = createSkillActivator({
      classifier,
      enableLlmClassifier: false,
      enableKeywordMatch: false,
    });
    const result = await testBlock(block, {
      input: { message: "please handle this" },
    });
    expect(result.error).toBeNull();
    expect(ran).toBe(0);
    expect(result.state.session.activeSkills ?? []).toEqual([]);
  });
});
