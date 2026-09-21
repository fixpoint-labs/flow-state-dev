/**
 * AI SDK evaluate client + capability routing. No OpenRouter Decisions.
 */
import { describe, expect, it } from "vitest";
import { createAiSdkEvaluateClient } from "../src/client";
import { isEvaluationCapable } from "../src/capability";
import { toSdkQuestions } from "../src/sdk-map";
import { boolean, choice, noul, score } from "../src/schemas";

describe("isEvaluationCapable", () => {
  it("treats Gateway Jev and doEvaluate objects as evaluate-capable", () => {
    expect(isEvaluationCapable("typesafe-ai/jev")).toBe(true);
    expect(isEvaluationCapable("typesafe-ai/jev-latest")).toBe(true);
    expect(isEvaluationCapable("~typesafe/jev-latest")).toBe(true);
    expect(isEvaluationCapable({ doEvaluate: async () => ({}) })).toBe(true);
  });

  it("treats a language model id as System 2", () => {
    expect(isEvaluationCapable("openai/gpt-5.4-mini")).toBe(false);
    expect(isEvaluationCapable("anthropic/claude-sonnet-4.6")).toBe(false);
  });
});

describe("createAiSdkEvaluateClient", () => {
  it("maps noul questions to boolean and lifts confidence from providerMetadata", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const client = createAiSdkEvaluateClient({
      evaluate: async (args) => {
        seen.push(args as unknown as Record<string, unknown>);
        return {
          answers: {
            urgent: { type: "boolean", probability: 0.91 },
            team: { type: "choice", choice: "billing", probabilities: { billing: 0.9, other: 0.1 } },
            severity: { type: "score", score: 1.2, probabilities: { "0": 0.1, "1": 0.8, "2": 0.1 } },
          },
          providerMetadata: { typesafe: { confidence: { team: 0.77, severity: 0.64 } } },
        };
      },
    });

    const questions = {
      urgent: noul("Urgent?"),
      team: choice("Which team?", { billing: "Pay", other: "Else" }),
      severity: score("How bad?", ["low", "mid", "high"]),
    };

    const out = await client.evaluate({
      state: "charged twice",
      questions,
    });

    expect(seen[0]?.model).toBe("typesafe-ai/jev");
    expect(seen[0]?.questions).toEqual(toSdkQuestions(questions));
    expect(out.path).toBe("evaluate");
    expect(out.answers.urgent).toEqual({ type: "noul", noul: 0.91 });
    expect(out.answers.team).toMatchObject({
      type: "choice",
      choice: "billing",
      confidence: 0.77,
    });
    expect(out.answers.severity).toMatchObject({ type: "score", score: 1.2, confidence: 0.64 });
  });

  it("does not invent confidence when TypeSafe omitted it", async () => {
    const client = createAiSdkEvaluateClient({
      evaluate: async () => ({
        answers: {
          team: { type: "choice", choice: "billing", probabilities: { billing: 0.9 } },
        },
      }),
    });
    const out = await client.evaluate({
      state: "x",
      questions: { team: choice("Which team?", { billing: "Pay" }) },
    });
    expect(out.answers.team).toEqual({
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.9 },
    });
    expect("confidence" in (out.answers.team ?? {})).toBe(false);
  });

  it("keeps boolean answers as boolean when the question was boolean", async () => {
    const client = createAiSdkEvaluateClient({
      evaluate: async () => ({
        answers: { refunded: { type: "boolean", probability: 0.2 } },
      }),
    });
    const out = await client.evaluate({
      state: "thanks",
      questions: { refunded: boolean("Was a refund issued?") },
    });
    expect(out.answers.refunded).toEqual({ type: "boolean", probability: 0.2 });
  });
});
