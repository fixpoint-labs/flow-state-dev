/**
 * System 2 fallback: same questions, structured generation, no Jev.
 */
import { describe, expect, it } from "vitest";
import { FlowError } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { evaluator } from "../src/evaluate";
import { runEvaluate } from "../src/run-evaluate";
import { boolean, choice, noul, score } from "../src/schemas";
import { formatSystem2Prompt, structuredToAnswers } from "../src/system-2";

const QUESTIONS = {
  team: choice("Which team?", { billing: "Pay", technical: "Bugs" }),
  urgent: noul("Is this urgent?"),
  severity: score("How bad?", ["low", "mid", "high"]),
};

describe("system2Evaluate", () => {
  it("maps structured output onto lab answers and marks path system-2", async () => {
    const result = await runEvaluate({
      state: "card charged twice",
      questions: QUESTIONS,
      model: "openai/gpt-5.4-mini",
      generate: async ({ prompt, model }) => {
        expect(model).toBe("openai/gpt-5.4-mini");
        expect(prompt).toContain("card charged twice");
        expect(prompt).toContain("Which team?");
        return {
          team: { type: "choice" as const, choice: "billing" },
          urgent: { type: "boolean" as const, probability: 0.8 },
          severity: { type: "score" as const, score: 1 },
        };
      },
    });

    expect(result.path).toBe("system-2");
    expect(result.provider).toBe("system-2");
    expect(result.answers.team).toEqual({
      type: "choice",
      choice: "billing",
      probabilities: { billing: 1 },
      confidence: 1,
    });
    expect(result.answers.urgent).toEqual({ type: "noul", noul: 0.8 });
    expect(result.answers.severity).toMatchObject({ type: "score", score: 1, confidence: 1 });
  });

  it("is the path evaluator takes for a language-model id", async () => {
    const block = evaluator({
      name: "classify",
      questions: { urgent: boolean("Urgent?") },
      model: "openai/gpt-5.4-mini",
      generate: async () => ({ urgent: { type: "boolean" as const, probability: 0.1 } }),
    });
    const result = await testBlock(block, { input: { state: "thanks" } });
    expect(result.error).toBeNull();
    expect(result.output).toMatchObject({
      path: "system-2",
      answers: { urgent: { type: "boolean", probability: 0.1 } },
    });
  });

  it("refuses System 2 without a language-model key when generate is not injected", async () => {
    const previous = {
      gateway: process.env.AI_GATEWAY_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      oidc: process.env.VERCEL_OIDC_TOKEN,
    };
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;
    try {
      await expect(
        runEvaluate({
          state: "x",
          questions: { urgent: boolean("Urgent?") },
          model: "openai/gpt-5.4-mini",
        }),
      ).rejects.toMatchObject({ code: "missing_api_key" });
    } finally {
      if (previous.gateway !== undefined) process.env.AI_GATEWAY_API_KEY = previous.gateway;
      if (previous.openai !== undefined) process.env.OPENAI_API_KEY = previous.openai;
      if (previous.oidc !== undefined) process.env.VERCEL_OIDC_TOKEN = previous.oidc;
    }
  });

  it("keeps noul dual-read when mapping structured boolean answers", () => {
    const answers = structuredToAnswers(
      { flag: noul("Yes?") },
      { flag: { type: "boolean", probability: 0.4 } },
    );
    expect(answers.flag).toEqual({ type: "noul", noul: 0.4 });
    expect(formatSystem2Prompt("hello", { flag: noul("Yes?") })).toContain("Yes?");
  });

  it("does not treat a missing_api_key as a network evaluate call", async () => {
    try {
      await runEvaluate({
        state: "x",
        questions: { urgent: boolean("Urgent?") },
        model: "openai/gpt-5.4-mini",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(FlowError);
      expect(String(error)).toContain("System 2");
      expect(String(error)).not.toContain("OPENROUTER");
    }
  });
});
