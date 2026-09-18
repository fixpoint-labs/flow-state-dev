/**
 * Handler-style TypeSafe / Jev block.
 *
 * Not a `generator`. Jev does not produce text. The block takes `state` plus
 * a map of typed questions and returns structured answers the next step
 * branches on. The model is Jev because the Decisions API is Jev-shaped —
 * this does not go through `createModelResolver`.
 */

import { handler, type BlockDefinition } from "@flow-state-dev/core";
import type { TypeSafeDecisionsClient } from "./client";
import { TypeSafeError } from "./errors";
import { runTypeSafeDecision } from "./run-decision";
import {
  DEFAULT_TYPESAFE_MODEL,
  evaluateInputSchema,
  evaluateOutputSchema,
  type AnswersFor,
  type TypeSafeEvaluateInput,
  type TypeSafeEvaluateOutput,
  type TypeSafeQuestions,
} from "./schemas";

export interface TypeSafeEvaluateConfig<
  Q extends TypeSafeQuestions = TypeSafeQuestions,
> {
  /** Block instance name. */
  name: string;
  /**
   * Questions composed with the block. Input `questions` override these when
   * present. One of factory or input must supply a non-empty map.
   */
  questions?: Q;
  /**
   * OpenRouter model id. Defaults to `~typesafe/jev-latest` because this
   * block is the Jev Decisions call, not a chat completion.
   */
  model?: string;
  /**
   * Host-owned OpenRouter key. Defaults to `process.env.OPENROUTER_API_KEY`.
   * Never read from action input (BP-031).
   */
  apiKey?: string;
  /** Injected client. Tests pass a scripted one so CI never hits the network. */
  client?: TypeSafeDecisionsClient;
}

export type TypeSafeEvaluateBlock<Q extends TypeSafeQuestions = TypeSafeQuestions> =
  BlockDefinition<
    typeof evaluateInputSchema,
    typeof evaluateOutputSchema,
    TypeSafeEvaluateInput,
    TypeSafeEvaluateOutput & { answers: AnswersFor<Q> }
  >;

/**
 * FSD handler that evaluates `state` against typed TypeSafe questions.
 *
 * ```ts
 * const classify = typesafeEvaluate({
 *   name: "classify-ticket",
 *   questions: {
 *     department: choice("Which team?", { billing: "Payments", technical: "Bugs" }),
 *     urgent: noul("Does this need urgent attention?"),
 *   },
 * });
 * ```
 */
export function typesafeEvaluate<Q extends TypeSafeQuestions = TypeSafeQuestions>(
  config: TypeSafeEvaluateConfig<Q>,
): TypeSafeEvaluateBlock<Q> {
  const factoryQuestions = config.questions;
  const model = config.model ?? DEFAULT_TYPESAFE_MODEL;
  const injected = config.client;

  return handler({
    name: config.name,
    inputSchema: evaluateInputSchema,
    outputSchema: evaluateOutputSchema,
    execute: async (input) => {
      const questions = input.questions ?? factoryQuestions;
      if (questions === undefined || Object.keys(questions).length === 0) {
        throw new TypeSafeError(
          "missing_questions",
          `Block "${config.name}" needs a questions map on the factory or the input.`,
        );
      }

      const result = await runTypeSafeDecision({
        state: input.state,
        questions,
        model,
        apiKey: config.apiKey,
        client: injected,
      });
      return result as TypeSafeEvaluateOutput & { answers: AnswersFor<Q> };
    },
  }) as TypeSafeEvaluateBlock<Q>;
}

/** Alias that names the model rather than the vendor. */
export const jevDecide = typesafeEvaluate;
