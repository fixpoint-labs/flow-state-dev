/**
 * Scripted OpenRouter Decisions client — no network.
 */

import type { TypeSafeDecisionsClient, TypeSafeRequest } from "../src/client";
import type { TypeSafeEvaluateOutput } from "../src/schemas";

export interface ScriptedCall {
  request: TypeSafeRequest;
}

export function scriptedClient(
  result: TypeSafeEvaluateOutput | ((request: TypeSafeRequest) => TypeSafeEvaluateOutput),
) {
  const calls: ScriptedCall[] = [];
  const client: TypeSafeDecisionsClient = {
    async evaluate(request) {
      calls.push({ request });
      return typeof result === "function" ? result(request) : result;
    },
  };
  return { client, calls };
}

export const BILLING_RESULT: TypeSafeEvaluateOutput = {
  model: "typesafe/jev-1.13-20260917",
  provider: "TypeSafe",
  answers: {
    department: {
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.87, technical: 0.13, sales: 0 },
      confidence: 0.8,
    },
    is_urgent: { type: "noul", noul: 0.95 },
    frustration: {
      type: "score",
      score: 1.04,
      legend: { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
      probabilities: { "0": 0, "1": 0.96, "2": 0.04 },
      confidence: 0.93,
    },
  },
  usage: { input_tokens: 427, output_tokens: 73, cost: 0.000017934 },
};

export const LOW_CONFIDENCE_RESULT: TypeSafeEvaluateOutput = {
  model: "typesafe/jev-1.13-20260917",
  answers: {
    department: {
      type: "choice",
      choice: "technical",
      probabilities: { billing: 0.34, technical: 0.36, sales: 0.3 },
      confidence: 0.12,
    },
    is_urgent: { type: "noul", noul: 0.2 },
    frustration: {
      type: "score",
      score: 0.4,
      legend: { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
      probabilities: { "0": 0.7, "1": 0.2, "2": 0.1 },
      confidence: 0.55,
    },
  },
};
