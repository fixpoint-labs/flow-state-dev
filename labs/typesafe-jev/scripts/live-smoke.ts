/**
 * Optional live call against AI SDK `experimental_evaluate` + Gateway Jev.
 *
 *   cd labs/typesafe-jev && pnpm live-smoke
 *
 * Requires AI_GATEWAY_API_KEY, TYPESAFE_AI_API_KEY, or VERCEL_OIDC_TOKEN.
 * Not run in CI.
 */

import { createAiSdkEvaluateClient, resolveEvaluateApiKey } from "../src/client";
import { TICKET_QUESTIONS } from "../src/questions";
import { routeByChoice } from "../src/route";
import { SYSTEM_ONE_ROUTE_QUESTION } from "../src/router";
import { choice, isChoiceAnswer, truthProbability } from "../src/schemas";

resolveEvaluateApiKey();

const state = {
  subject: "Duplicate charge",
  message: "My card was charged twice. Help ASAP.",
};

const client = createAiSdkEvaluateClient();

const result = await client.evaluate({
  state,
  questions: TICKET_QUESTIONS,
});

const department = result.answers.department;
const urgent = result.answers.is_urgent;
if (!isChoiceAnswer(department) || truthProbability(urgent) === undefined) {
  throw new Error("unexpected answer types from live evaluate call");
}

const decision = routeByChoice({
  choice: department,
  minConfidence: 0.55,
  escalateIf: { truth: urgent, whenAbove: 0.8, andChoice: "billing" },
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
        path: result.path,
        answers: result.answers,
        decision,
      },
      modeRouterChoice: {
        model: mode.model,
        path: mode.path,
        answer: mode.answers[SYSTEM_ONE_ROUTE_QUESTION],
      },
    },
    null,
    2,
  ),
);
