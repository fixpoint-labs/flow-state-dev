/**
 * Teaching excerpt: cascadingRouter with confidence-gated edges.
 *
 * Two-level tree. A branch is taken only when choice matches and
 * confidence (and optional probability) clears the gate. Missing
 * confidence or probabilities (LM adapters) land on `ambiguous`.
 * Same factory accepts `typesafe-ai/jev` or `openai.evaluationModel(...)`.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { cascadingRouter } from "../../src/index";

const inputSchema = z.object({
  subject: z.string(),
  message: z.string(),
});

const outputSchema = z.object({
  path: z.enum(["escalate", "billing-queue", "tech-queue", "review"]),
});

function leaf(path: z.infer<typeof outputSchema>["path"]) {
  return handler({
    name: path,
    inputSchema,
    outputSchema,
    execute: () => ({ path }),
  });
}

const escalate = leaf("escalate");
const billingQueue = leaf("billing-queue");
const techQueue = leaf("tech-queue");
const review = leaf("review");

export const triage = cascadingRouter({
  name: "triage",
  inputSchema,
  outputSchema,
  root: {
    id: "department",
    instructions: "Which team should handle this ticket?",
    branches: {
      billing: {
        description: "Charges and refunds",
        minConfidence: 0.6,
        minProbability: 0.7,
        next: {
          id: "urgency",
          instructions: "How urgent is this billing issue?",
          branches: {
            high: {
              description: "Needs immediate attention",
              minConfidence: 0.6,
              block: escalate,
            },
            low: {
              description: "Can wait in the billing queue",
              minConfidence: 0.5,
              block: billingQueue,
            },
          },
        },
      },
      technical: {
        description: "Bugs and outages",
        minConfidence: 0.6,
        block: techQueue,
      },
    },
  },
  ambiguous: review,
});
