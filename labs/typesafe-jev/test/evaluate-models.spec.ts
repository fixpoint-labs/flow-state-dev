/**
 * One evaluate surface: Jev strings and evaluationModel instances.
 * No generator+Zod shim. Registry fallback does not retry or swap.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { isEvaluationCapable, resolveEvaluateModel } from "../src/capability";
import { evaluator } from "../src/evaluate";
import { runEvaluate } from "../src/run-evaluate";
import { boolean, choice } from "../src/schemas";

describe("isEvaluationCapable / resolveEvaluateModel", () => {
  it("accepts Jev ids, other evaluate strings, and doEvaluate instances", () => {
    expect(isEvaluationCapable("typesafe-ai/jev")).toBe(true);
    expect(isEvaluationCapable("typesafe-ai/jev-latest")).toBe(true);
    expect(isEvaluationCapable("openai/gpt-5.4-mini")).toBe(true);
    expect(isEvaluationCapable({ doEvaluate: async () => ({}) })).toBe(true);
    expect(resolveEvaluateModel(undefined)).toBe("typesafe-ai/jev");
  });

  it("rejects generate-only language model objects", () => {
    expect(isEvaluationCapable({ doGenerate: async () => ({}) })).toBe(false);
    expect(() => resolveEvaluateModel({ doGenerate: async () => ({}) })).toThrow(
      /evaluation model/,
    );
  });
});

describe("runEvaluate uses experimental_evaluate only", () => {
  it("sends a Jev id through the injected evaluate fn", async () => {
    const seen: unknown[] = [];
    const result = await runEvaluate({
      state: "card charged twice",
      questions: { team: choice("Which team?", { billing: "Pay" }) },
      model: "typesafe-ai/jev",
      evaluate: async (args) => {
        seen.push(args.model);
        return {
          answers: { team: { type: "choice", choice: "billing", probabilities: { billing: 0.9 } } },
          providerMetadata: { typesafe: { confidence: { team: 0.8 } } },
        };
      },
    });
    expect(seen).toEqual(["typesafe-ai/jev"]);
    expect(result.path).toBe("evaluate");
    expect(result.answers.team).toMatchObject({
      type: "choice",
      choice: "billing",
      confidence: 0.8,
    });
  });

  it("sends openai.evaluationModel-shaped instances through the same fn", async () => {
    const openaiEval = {
      specificationVersion: "v4" as const,
      provider: "openai.evaluation",
      modelId: "gpt-5.4-mini",
      supportedQuestionTypes: ["choice", "score", "boolean"] as const,
      doEvaluate: async () => {
        throw new Error("doEvaluate is not called when evaluate is injected");
      },
    };
    const seen: unknown[] = [];
    const result = await runEvaluate({
      state: "card charged twice",
      questions: { team: choice("Which team?", { billing: "Pay" }) },
      model: openaiEval,
      evaluate: async (args) => {
        seen.push(args.model);
        return {
          answers: { team: { type: "choice", choice: "billing" } },
        };
      },
    });
    expect(seen[0]).toBe(openaiEval);
    expect(result.path).toBe("evaluate");
    expect(result.answers.team).toEqual({ type: "choice", choice: "billing" });
    expect("confidence" in (result.answers.team ?? {})).toBe(false);
    expect("probabilities" in (result.answers.team ?? {})).toBe(false);
  });

  it("evaluator accepts the same instance on the factory", async () => {
    const block = evaluator({
      name: "classify",
      model: {
        doEvaluate: async () => ({ answers: {} }),
        modelId: "gpt-5.4-mini",
      },
      questions: { urgent: boolean("Urgent?") },
      evaluate: async () => ({
        answers: { urgent: { type: "boolean", probability: 0.2 } },
      }),
    });
    const result = await testBlock(block, { input: { state: "thanks" } });
    expect(result.error).toBeNull();
    expect(result.output).toMatchObject({
      path: "evaluate",
      answers: { urgent: { type: "boolean", probability: 0.2 } },
    });
  });
});
