/**
 * Teaching excerpt: atomic evaluator on one surface.
 *
 * Prefer Jev. The same factory accepts openai.evaluationModel(...) —
 * AI SDK experimental_evaluate, not an FSD generateObject shim.
 */
import { boolean, choice, evaluator, score } from "../../src/index";

const questions = {
  department: choice("Which team?", {
    billing: "Payments and refunds",
    technical: "Bugs and outages",
  }),
  urgent: boolean("Does this need urgent attention?", {
    true: "Page someone now.",
    false: "It can wait in a queue.",
  }),
  severity: score("How severe?", ["low", "medium", "high"]),
};

export const classifyWithJev = evaluator({
  name: "classify-ticket",
  model: "typesafe-ai/jev",
  questions,
});

/**
 * Popular-model path. Host wires the real adapter:
 *
 *   import { openai } from "@ai-sdk/openai";
 *   model: openai.evaluationModel("gpt-5.4-mini")
 *
 * Same evaluator. LM adapters omit TypeSafe confidence and
 * choice/score distributions — cascadingRouter fail-closes those gates.
 */
export function classifyWithEvaluationModel(model: unknown) {
  return evaluator({
    name: "classify-ticket-openai",
    model,
    questions,
  });
}
