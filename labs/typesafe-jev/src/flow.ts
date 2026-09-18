/**
 * Demo flow: classify a support ticket, then route on the answers.
 *
 * `triage` is the pattern: evaluate → confidence-gated intent router.
 * `evaluate` is the primitive: state + questions in, answers out.
 */

import {
  defineFlow,
  handler,
  router,
  sequencer,
} from "@flow-state-dev/core";
import { z } from "zod";
import type { TypeSafeDecisionsClient } from "./client";
import { typesafeEvaluate } from "./evaluate";
import { TICKET_QUESTIONS } from "./questions";
import { routeByChoice } from "./route";
import {
  evaluateInputSchema,
  evaluateOutputSchema,
  isChoiceAnswer,
  isNoulAnswer,
} from "./schemas";

export const FLOW_KIND = "ticket-triage";

export const ticketInputSchema = z.object({
  subject: z.string(),
  message: z.string(),
});

export const triageOutputSchema = z.object({
  destination: z.string(),
  reason: z.string(),
  model: z.string(),
  answers: evaluateOutputSchema.shape.answers,
});

export type TicketInput = z.infer<typeof ticketInputSchema>;
export type TriageOutput = z.infer<typeof triageOutputSchema>;

const DESTINATIONS = ["billing", "technical", "sales", "escalate"] as const;

export interface TicketTriageOptions {
  /** Scripted client for tests. Host runs omit this and use OPENROUTER_API_KEY. */
  client?: TypeSafeDecisionsClient;
  apiKey?: string;
}

function destinationHandler(destination: (typeof DESTINATIONS)[number]) {
  return handler({
    name: destination,
    inputSchema: triageOutputSchema,
    outputSchema: triageOutputSchema,
    execute: (input) => ({ ...input, destination }),
  });
}

function buildTriagePipeline(options: TicketTriageOptions) {
  const classify = typesafeEvaluate({
    name: "classify-ticket",
    questions: TICKET_QUESTIONS,
    client: options.client,
    apiKey: options.apiKey,
  });

  const routes = DESTINATIONS.map(destinationHandler);

  const dispatch = router({
    name: "dispatch",
    inputSchema: triageOutputSchema,
    outputSchema: triageOutputSchema,
    routes,
    execute: (input) => {
      const match = routes.find((route) => route.name === input.destination);
      if (match === undefined) {
        throw new Error(`No route named "${input.destination}".`);
      }
      return match;
    },
  });

  return sequencer({
    name: "triage",
    inputSchema: ticketInputSchema,
    outputSchema: triageOutputSchema,
  })
    .step(
      (ticket: TicketInput) => ({ state: ticket }),
      classify,
    )
    .step(
      handler({
        name: "decide-route",
        inputSchema: evaluateOutputSchema,
        outputSchema: triageOutputSchema,
        execute: (evaluated) => {
          const department = evaluated.answers.department;
          const urgent = evaluated.answers.is_urgent;
          if (!isChoiceAnswer(department)) {
            throw new Error("department answer was not a choice.");
          }
          if (!isNoulAnswer(urgent)) {
            throw new Error("is_urgent answer was not a noul.");
          }
          const decision = routeByChoice({
            choice: department,
            minConfidence: 0.55,
            escalateIf: { noul: urgent, whenAbove: 0.8, andChoice: "billing" },
          });
          return {
            destination: decision.destination,
            reason: decision.reason,
            model: evaluated.model,
            answers: evaluated.answers,
          };
        },
      }),
    )
    .step(dispatch);
}

/**
 * Ticket-triage flow used by `fsdev run` and the lab tests.
 */
export function createTicketTriageFlow(options: TicketTriageOptions = {}) {
  const evaluate = typesafeEvaluate({
    name: "evaluate",
    client: options.client,
    apiKey: options.apiKey,
  });

  const definition = defineFlow({
    kind: FLOW_KIND,
    requireUser: true,
    actions: {
      triage: { block: buildTriagePipeline(options) },
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
