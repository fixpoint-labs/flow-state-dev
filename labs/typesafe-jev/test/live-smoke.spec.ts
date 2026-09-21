/**
 * Optional live probe. Off unless TYPESAFE_LIVE=1 so CI stays offline.
 */
import { describe, expect, it } from "vitest";
import { createAiSdkEvaluateClient, resolveEvaluateApiKey } from "../src/client";
import { TICKET_QUESTIONS } from "../src/questions";
import { isChoiceAnswer, isScoreAnswer, truthProbability } from "../src/schemas";

const live = process.env.TYPESAFE_LIVE === "1";

describe.skipIf(!live)("live experimental_evaluate", () => {
  it("classifies a billing ticket with boolean / choice / score answers", async () => {
    resolveEvaluateApiKey();
    const client = createAiSdkEvaluateClient();
    const result = await client.evaluate({
      state: {
        subject: "Duplicate charge",
        message: "My card was charged twice. Help ASAP.",
      },
      questions: TICKET_QUESTIONS,
    });

    expect(isChoiceAnswer(result.answers.department)).toBe(true);
    expect(truthProbability(result.answers.is_urgent)).toEqual(expect.any(Number));
    expect(isScoreAnswer(result.answers.frustration)).toBe(true);
    if (isChoiceAnswer(result.answers.department)) {
      expect(result.answers.department.choice).toBe("billing");
    }
    expect(result.path).toBe("evaluate");
  }, 30_000);
});
