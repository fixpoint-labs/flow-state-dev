/**
 * Demo of the production-looking System One family.
 *
 * `route` is Jake's sketch: systemOneRouter over plan / review / default(chat).
 * Stub pipelines return which path ran and echo the input.
 */

import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import type { TypeSafeDecisionsClient } from "./client";
import { typesafeEvaluate } from "./evaluate";
import { systemOneRouter } from "./router";
import { evaluateInputSchema, evaluateOutputSchema } from "./schemas";

export const SYSTEM_ONE_FLOW_KIND = "system-one";

export const modeInputSchema = z.object({
  message: z.string(),
});

export const modeOutputSchema = z.object({
  path: z.enum(["plan", "review", "chat"]),
  echo: modeInputSchema,
});

export type ModeInput = z.infer<typeof modeInputSchema>;
export type ModeOutput = z.infer<typeof modeOutputSchema>;

export interface SystemOneDemoOptions {
  client?: TypeSafeDecisionsClient;
  apiKey?: string;
  minConfidence?: number;
}

function stubPipeline(path: ModeOutput["path"]) {
  return handler({
    name: path,
    inputSchema: modeInputSchema,
    outputSchema: modeOutputSchema,
    execute: (input) => ({ path, echo: input }),
  });
}

export const planPipeline = stubPipeline("plan");
export const reviewPipeline = stubPipeline("review");
export const chatPipeline = stubPipeline("chat");

/**
 * Mode router matching the target API: described routes plus a bare default.
 */
export function createModeRouter(options: SystemOneDemoOptions = {}) {
  return systemOneRouter({
    name: "route-mode",
    inputSchema: modeInputSchema,
    outputSchema: modeOutputSchema,
    minConfidence: options.minConfidence,
    client: options.client,
    apiKey: options.apiKey,
    routes: {
      plan: {
        description: "user is asking to plan something or needs to plan some work",
        block: planPipeline,
      },
      review: {
        description: "User needs to review work that was just performed",
        block: reviewPipeline,
      },
      default: chatPipeline,
    },
  });
}

/**
 * Demo flow: `route` is the star; `evaluate` is the low-level primitive.
 */
export function createSystemOneDemoFlow(options: SystemOneDemoOptions = {}) {
  const evaluate = typesafeEvaluate({
    name: "evaluate",
    client: options.client,
    apiKey: options.apiKey,
  });

  const definition = defineFlow({
    kind: SYSTEM_ONE_FLOW_KIND,
    requireUser: true,
    actions: {
      route: { block: createModeRouter(options) },
      evaluate: {
        block: sequencer({
          name: "evaluate-action",
          inputSchema: evaluateInputSchema,
          outputSchema: evaluateOutputSchema,
        }).step(evaluate),
      },
    },
  });

  return definition();
}
