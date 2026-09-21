/**
 * Jev skill classifier: catalog Choice + threshold + validNames guard.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import {
  SYSTEM_ONE_SKILL_NONE,
  SYSTEM_ONE_SKILL_QUESTION,
  createSystemOneSkillClassifier,
} from "../src/skill-classifier";
import { DEMO_SKILLS } from "../src/skill-activator-flow";
import { createSkillActivator } from "@flow-state-dev/orchestration";
import { sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { skillsCatalogAnchor } from "../src/skill-classifier";
import type { TypeSafeEvaluateOutput } from "../src/schemas";
import { scriptedClient } from "./scripted-client";

function skillChoice(name: string, confidence: number): TypeSafeEvaluateOutput {
  return {
    model: "typesafe/jev-1.13-20260917",
    answers: {
      [SYSTEM_ONE_SKILL_QUESTION]: {
        type: "choice",
        choice: name,
        probabilities: { [name]: confidence },
        confidence,
      },
    },
  };
}

function seededActivator(classifier: ReturnType<typeof createSystemOneSkillClassifier>) {
  return sequencer({
    name: "seeded-classifier",
    inputSchema: z.object({ message: z.string() }).passthrough(),
  })
    .tap(skillsCatalogAnchor())
    .tap(
      createSkillActivator({
        classifier,
        initialSkills: DEMO_SKILLS,
        enableKeywordMatch: false,
      }),
    );
}

describe("createSystemOneSkillClassifier", () => {
  it("activates a catalog skill when slash+keyword miss and confidence is high", async () => {
    const { client, calls } = scriptedClient(skillChoice("billing", 0.91));
    const result = await testBlock(seededActivator(createSystemOneSkillClassifier({ client })), {
      input: { message: "the card was charged twice" },
    });
    expect(result.error).toBeNull();
    expect(result.state.session.activeSkills).toEqual([
      expect.objectContaining({ name: "billing", source: "classifier" }),
    ]);
    expect(calls).toHaveLength(1);
    const question = calls[0]?.request.questions?.[SYSTEM_ONE_SKILL_QUESTION];
    expect(question?.type).toBe("choice");
    if (question?.type === "choice") {
      expect(Object.keys(question.criteria)).toEqual(
        expect.arrayContaining(["billing", "launch", SYSTEM_ONE_SKILL_NONE]),
      );
    }
  });

  it("does not activate when confidence is below the threshold", async () => {
    const { client, calls } = scriptedClient(skillChoice("billing", 0.2));
    const result = await testBlock(seededActivator(createSystemOneSkillClassifier({ client })), {
      input: { message: "the card was charged twice" },
    });
    expect(result.error).toBeNull();
    expect(result.state.session.activeSkills ?? []).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("rejects an invented skill name even at high confidence", async () => {
    const { client } = scriptedClient(skillChoice("not-a-skill", 0.99));
    const result = await testBlock(seededActivator(createSystemOneSkillClassifier({ client })), {
      input: { message: "the card was charged twice" },
    });
    expect(result.error).toBeNull();
    expect(result.state.session.activeSkills ?? []).toEqual([]);
  });
});
