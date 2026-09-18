/**
 * Optional live call against OpenRouter Decisions.
 *
 *   cd labs/typesafe-jev && pnpm live-smoke
 *
 * Requires OPENROUTER_API_KEY. Not run in CI.
 */

import { createOpenRouterDecisionsClient, resolveOpenRouterApiKey } from "../src/client";
import { TICKET_QUESTIONS } from "../src/questions";
import { routeByChoice } from "../src/route";
import { isChoiceAnswer, isNoulAnswer } from "../src/schemas";

const state = {
  subject: "Duplicate charge",
  message: "My card was charged twice. Help ASAP.",
};

const client = createOpenRouterDecisionsClient({
  apiKey: resolveOpenRouterApiKey(),
});

const result = await client.evaluate({
  state,
  questions: TICKET_QUESTIONS,
});

const department = result.answers.department;
const urgent = result.answers.is_urgent;
if (!isChoiceAnswer(department) || !isNoulAnswer(urgent)) {
  throw new Error("unexpected answer types from live Jev call");
}

const decision = routeByChoice({
  choice: department,
  minConfidence: 0.55,
  escalateIf: { noul: urgent, whenAbove: 0.8, andChoice: "billing" },
});

console.log(
  JSON.stringify(
    {
      model: result.model,
      provider: result.provider,
      usage: result.usage,
      answers: result.answers,
      decision,
    },
    null,
    2,
  ),
);
