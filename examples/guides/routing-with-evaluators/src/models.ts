// The two evaluation models the example runs on.
//
// Jev reports how confident it is, so a `cascadingRouter` tree can route on
// it. OpenAI's evaluation model reports no confidence, so the same tree
// sends every ticket to review; `routeWithoutConfidence` runs it to show that.
import { createOpenAI, openai } from "@ai-sdk/openai";
import type { EvaluationModel } from "@flow-state-dev/core";

/** Jev, as a model string. It resolves through Vercel's AI Gateway (`AI_GATEWAY_API_KEY`). */
export const JEV = "typesafe-ai/jev";

/**
 * OpenAI's evaluation model, which reports no confidence. With
 * `OPENAI_API_KEY` it calls OpenAI directly. Otherwise it goes through the
 * AI Gateway's OpenAI-compatible endpoint with `AI_GATEWAY_API_KEY`: the
 * gateway serves no `openai/...` evaluation model strings, so this is an
 * instance, not a string. Nothing is called until an action runs.
 */
export function modelWithoutConfidence(): EvaluationModel {
  if (process.env.OPENAI_API_KEY) {
    return openai.evaluationModel("gpt-5.4-mini") as unknown as EvaluationModel;
  }
  const gateway = createOpenAI({
    baseURL: "https://ai-gateway.vercel.sh/v1",
    apiKey: process.env.AI_GATEWAY_API_KEY,
  });
  return gateway.evaluationModel("openai/gpt-5.4-mini") as unknown as EvaluationModel;
}
