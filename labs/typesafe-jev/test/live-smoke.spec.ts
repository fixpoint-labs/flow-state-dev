/**
 * Optional live probe. Off unless TYPESAFE_LIVE=1 so CI stays offline.
 */
import { describe, expect, it } from "vitest";
import { createOpenRouterDecisionsClient, resolveOpenRouterApiKey } from "../src/client";
import { TICKET_QUESTIONS } from "../src/questions";
import { isChoiceAnswer, isNoulAnswer, isScoreAnswer } from "../src/schemas";

const live = process.env.TYPESAFE_LIVE === "1";

describe.skipIf(!live)("live OpenRouter Decisions", () => {
  it("classifies a billing ticket with noul / choice / score answers", async () => {
    const client = createOpenRouterDecisionsClient({
      apiKey: resolveOpenRouterApiKey(),
    });
    const result = await client.evaluate({
      state: {
        subject: "Duplicate charge",
        message: "My card was charged twice. Help ASAP.",
      },
      questions: TICKET_QUESTIONS,
    });

    expect(isChoiceAnswer(result.answers.department)).toBe(true);
    expect(isNoulAnswer(result.answers.is_urgent)).toBe(true);
    expect(isScoreAnswer(result.answers.frustration)).toBe(true);
    if (isChoiceAnswer(result.answers.department)) {
      expect(result.answers.department.choice).toBe("billing");
    }
  }, 30_000);
});
