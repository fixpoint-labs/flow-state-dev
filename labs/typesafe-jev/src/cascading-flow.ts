/**
 * Demo: two-level cascadingRouter over ordinary leaf blocks.
 *
 * department → (billing → urgency → escalate | billing-queue) | tech-queue
 * Missing / low confidence lands on review. No trees inside evaluator.
 */

import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { cascadingRouter } from "./cascading-router";
import type { EvaluateClient } from "./client";
import type { GenerateStructuredFn } from "./system-2";

export const CASCADING_FLOW_KIND = "cascading-triage";

export const cascadeInputSchema = z.object({
  subject: z.string(),
  message: z.string(),
});

export const cascadeOutputSchema = z.object({
  path: z.enum(["escalate", "billing-queue", "tech-queue", "review"]),
  echo: cascadeInputSchema,
});

export type CascadeInput = z.infer<typeof cascadeInputSchema>;
export type CascadeOutput = z.infer<typeof cascadeOutputSchema>;

export interface CascadingTriageOptions {
  client?: EvaluateClient;
  apiKey?: string;
  model?: unknown;
  fallbackModel?: string;
  mode?: "evaluate" | "system-2";
  generate?: GenerateStructuredFn;
}

function leaf(path: CascadeOutput["path"]) {
  return handler({
    name: path,
    inputSchema: cascadeInputSchema,
    outputSchema: cascadeOutputSchema,
    execute: (input) => ({ path, echo: input }),
  });
}

export const escalateLeaf = leaf("escalate");
export const billingQueueLeaf = leaf("billing-queue");
export const techQueueLeaf = leaf("tech-queue");
export const reviewLeaf = leaf("review");

/**
 * Two-level demo tree used by tests and `fsdev run cascading-triage route`.
 */
export function createCascadingTriageRouter(options: CascadingTriageOptions = {}) {
  return cascadingRouter({
    name: "cascading-triage",
    inputSchema: cascadeInputSchema,
    outputSchema: cascadeOutputSchema,
    client: options.client,
    apiKey: options.apiKey,
    model: options.model,
    fallbackModel: options.fallbackModel,
    mode: options.mode,
    generate: options.generate,
    ambiguous: reviewLeaf,
    root: {
      id: "department",
      instructions: "Which team should handle this ticket?",
      branches: {
        billing: {
          description: "Charges, invoices, and refunds",
          minConfidence: 0.6,
          minProbability: 0.7,
          next: {
            id: "urgency",
            instructions: "How urgent is this billing issue?",
            branches: {
              high: {
                description: "Needs immediate attention",
                minConfidence: 0.6,
                block: escalateLeaf,
              },
              low: {
                description: "Can wait in the billing queue",
                minConfidence: 0.5,
                block: billingQueueLeaf,
              },
            },
          },
        },
        technical: {
          description: "Bugs, outages, and integrations",
          minConfidence: 0.6,
          block: techQueueLeaf,
        },
      },
    },
  });
}

export function createCascadingTriageFlow(options: CascadingTriageOptions = {}) {
  const definition = defineFlow({
    kind: CASCADING_FLOW_KIND,
    requireUser: true,
    actions: {
      route: { block: createCascadingTriageRouter(options) },
    },
  });
  return definition();
}
