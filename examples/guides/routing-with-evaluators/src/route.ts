// Step 2 of the guide: one two-level `cascadingRouter` tree, built once by
// `triage(model)`. The flow runs it twice, on Jev (which reports confidence)
// and on a model that reports none, so the two runs can't drift apart.
import { evaluator, choice, handler, utility, type EvaluationModel } from "@flow-state-dev/core";
import { z } from "zod";
import { team, ticketSchema } from "./classify";

/** Where a ticket ended up. Every leaf, `review` included, returns this. */
export type Routed = { queue: "billing-urgent" | "billing" | "technical" | "review" };

const queue = (name: string, to: Routed["queue"]) =>
  handler({
    name,
    inputSchema: ticketSchema,
    outputSchema: z.object({ queue: z.enum(["billing-urgent", "billing", "technical", "review"]) }),
    execute: (): Routed => ({ queue: to }),
  });

// The leaves are ordinary blocks. These name the queue; yours could do anything.
const urgentBilling = queue("urgent-billing", "billing-urgent");
const billingQueue = queue("billing-queue", "billing");
const techQueue = queue("tech-queue", "technical");
const review = queue("review", "review");

const urgency = choice("How urgent is this billing issue?", {
  urgent: "Needs someone now",
  routine: "Can wait in the queue",
});

/** The triage tree, asking every level on `model`. */
export function triage(model: string | EvaluationModel) {
  const department = evaluator({
    name: "department",
    model,
    inputSchema: ticketSchema,
    state: (input) => input.message,
    questions: { team },
  });
  const billingUrgency = evaluator({
    name: "billing-urgency",
    model,
    inputSchema: ticketSchema,
    state: (input) => input.message,
    questions: { urgency },
  });

  return utility.cascadingRouter({
    name: "triage",
    ambiguous: review,
    root: {
      ask: department,
      on: "team",
      branches: {
        billing: {
          minConfidence: 0.6,
          next: {
            ask: billingUrgency,
            on: "urgency",
            branches: {
              urgent: { minConfidence: 0.6, block: urgentBilling },
              routine: { minConfidence: 0.5, block: billingQueue },
            },
          },
        },
        technical: { minConfidence: 0.6, block: techQueue },
      },
    },
  });
}
