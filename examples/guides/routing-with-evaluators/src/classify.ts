// Step 1 of the guide: one evaluator asking three typed questions about a
// support ticket. The model is a parameter so the flow can pass Jev and the
// tests can pass a mock evaluation model; the question set never changes.
import { evaluator, choice, score, boolean, type EvaluationModel } from "@flow-state-dev/core";
import { z } from "zod";

/** What every action in this example takes: the ticket's text. */
export const ticketSchema = z.object({ message: z.string().min(1) });

/** The team question. `route.ts` reuses it for the tree's first level. */
export const team = choice("Which team should handle this?", {
  billing: "Payments, charges and refunds",
  technical: "Bugs, errors and outages",
});

/** An evaluator that asks a choice, a score and a boolean about a ticket. */
export function classifyTicket(model: string | EvaluationModel) {
  return evaluator({
    name: "classify-ticket",
    model,
    inputSchema: ticketSchema,
    state: (input) => input.message,
    questions: {
      team,
      frustration: score("How frustrated is the customer?", ["Calm", "Annoyed", "Angry"]),
      urgent: boolean("Does this need someone now?"),
    },
  });
}
