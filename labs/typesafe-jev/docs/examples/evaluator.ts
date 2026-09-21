/**
 * Teaching excerpt: atomic evaluator.
 *
 * One state + one questions map. Combine answers in your code.
 * Evaluation-capable models hit experimental_evaluate (Gateway / Jev).
 * A language-model id trips System 2. Apps do not require Jev.
 */
import { boolean, choice, evaluator, score } from "../../src/index";

export const classifyTicket = evaluator({
  name: "classify-ticket",
  questions: {
    department: choice("Which team?", {
      billing: "Payments and refunds",
      technical: "Bugs and outages",
    }),
    urgent: boolean("Does this need urgent attention?", {
      true: "Page someone now.",
      false: "It can wait in a queue.",
    }),
    severity: score("How severe?", ["low", "medium", "high"]),
  },
});

/** Same questions, no Jev — structured-output System 2. */
export const classifyWithoutJev = evaluator({
  name: "classify-without-jev",
  model: "openai/gpt-5.4-mini",
  questions: {
    urgent: boolean("Is this urgent?"),
  },
});
