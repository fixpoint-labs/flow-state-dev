/**
 * Lab stand-in for a core `evaluator` block — sibling of `generator`.
 *
 * State + questions (choice / score / boolean) → typed answers.
 * Prefers AI SDK `experimental_evaluate` (Gateway / Jev) when the model
 * is evaluation-capable; falls back to structured-output System 2 when
 * it is not. This is still a handler: a fifth published block kind is
 * out of scope for this DNM.
 */

import { handler, type BlockDefinition } from "@flow-state-dev/core";
import type { EvaluateClient, EvaluateFn } from "./client";
import { TypeSafeError } from "./errors";
import { runEvaluate } from "./run-evaluate";
import {
  DEFAULT_EVALUATE_MODEL,
  evaluateInputSchema,
  evaluateOutputSchema,
  type AnswersFor,
  type TypeSafeEvaluateInput,
  type TypeSafeEvaluateOutput,
  type TypeSafeQuestions,
} from "./schemas";
import type { GenerateStructuredFn } from "./system-2";

export interface EvaluatorConfig<Q extends TypeSafeQuestions = TypeSafeQuestions> {
  /** Block instance name. */
  name: string;
  /**
   * Questions composed with the block. Input `questions` override these when
   * present. One of factory or input must supply a non-empty map.
   */
  questions?: Q;
  /**
   * Evaluate model (`typesafe-ai/jev`) or a language-model id that trips
   * the System 2 fallback.
   */
  model?: unknown;
  /** Language-model id used only on the System 2 path. */
  fallbackModel?: string;
  /** Force evaluate vs System 2. Default follows `isEvaluationCapable(model)`. */
  mode?: "evaluate" | "system-2";
  /**
   * Host-owned Gateway / TypeSafe key. Defaults to
   * `AI_GATEWAY_API_KEY` / `TYPESAFE_AI_API_KEY` / `VERCEL_OIDC_TOKEN`.
   * Never read from action input (BP-031).
   */
  apiKey?: string;
  /** Injected client. Tests pass a scripted one so CI never hits the network. */
  client?: EvaluateClient;
  evaluate?: EvaluateFn;
  generate?: GenerateStructuredFn;
}

export type EvaluatorBlock<Q extends TypeSafeQuestions = TypeSafeQuestions> = BlockDefinition<
  typeof evaluateInputSchema,
  typeof evaluateOutputSchema,
  TypeSafeEvaluateInput,
  TypeSafeEvaluateOutput & { answers: AnswersFor<Q> }
>;

/** @deprecated Use EvaluatorConfig. */
export type TypeSafeEvaluateConfig<Q extends TypeSafeQuestions = TypeSafeQuestions> =
  EvaluatorConfig<Q>;

/** @deprecated Use EvaluatorBlock. */
export type TypeSafeEvaluateBlock<Q extends TypeSafeQuestions = TypeSafeQuestions> =
  EvaluatorBlock<Q>;

/**
 * FSD handler stand-in for a core evaluator: `state` + typed questions → answers.
 *
 * ```ts
 * const classify = evaluator({
 *   name: "classify-ticket",
 *   questions: {
 *     department: choice("Which team?", { billing: "Payments", technical: "Bugs" }),
 *     urgent: boolean("Does this need urgent attention?"),
 *   },
 * });
 * ```
 */
export function evaluator<Q extends TypeSafeQuestions = TypeSafeQuestions>(
  config: EvaluatorConfig<Q>,
): EvaluatorBlock<Q> {
  const factoryQuestions = config.questions;

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

      const result = await runEvaluate({
        state: input.state,
        questions,
        model: config.model ?? DEFAULT_EVALUATE_MODEL,
        fallbackModel: config.fallbackModel,
        mode: config.mode,
        apiKey: config.apiKey,
        client: config.client,
        evaluate: config.evaluate,
        generate: config.generate,
      });
      return result as TypeSafeEvaluateOutput & { answers: AnswersFor<Q> };
    },
  }) as EvaluatorBlock<Q>;
}

/** Alias while the lab still says typesafeEvaluate. */
export const typesafeEvaluate = evaluator;

/** Alias that names the model rather than the vendor. */
export const jevDecide = evaluator;
