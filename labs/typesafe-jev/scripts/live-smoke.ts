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
import { SYSTEM_ONE_ROUTE_QUESTION } from "../src/router";
import { choice, isChoiceAnswer, isNoulAnswer } from "../src/schemas";

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

const mode = await client.evaluate({
  state: { message: "let us plan the launch" },
  questions: {
    [SYSTEM_ONE_ROUTE_QUESTION]: choice(
      "Which route should handle this input? Pick the best match.",
      {
        plan: "user is asking to plan something or needs to plan some work",
        review: "User needs to review work that was just performed",
      },
    ),
  },
});

console.log(
  JSON.stringify(
    {
      ticket: {
        model: result.model,
        provider: result.provider,
        usage: result.usage,
        answers: result.answers,
        decision,
      },
      modeRouterChoice: {
        model: mode.model,
        answer: mode.answers[SYSTEM_ONE_ROUTE_QUESTION],
      },
    },
    null,
    2,
  ),
);
