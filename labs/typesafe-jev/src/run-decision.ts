/**
 * Shared Decisions call used by typesafeEvaluate, systemOneRouter, and the
 * one-shot primitives. Not an FSD block — callers own composition.
 */

import {
  createOpenRouterDecisionsClient,
  resolveOpenRouterApiKey,
  type TypeSafeDecisionsClient,
} from "./client";
import { TypeSafeError } from "./errors";
import {
  DEFAULT_TYPESAFE_MODEL,
  type TypeSafeEvaluateOutput,
  type TypeSafeQuestions,
  type TypeSafeState,
} from "./schemas";

export interface RunTypeSafeDecisionOptions {
  state: TypeSafeState;
  questions: TypeSafeQuestions;
  model?: string;
  apiKey?: string;
  client?: TypeSafeDecisionsClient;
}

/**
 * Coerce a block input into a TypeSafe `state` (string, array, or object).
 */
export function asTypeSafeState(input: unknown): TypeSafeState {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) return input;
  if (input !== null && typeof input === "object") {
    return input as Record<string, unknown>;
  }
  throw new TypeSafeError(
    "invalid_state",
    "TypeSafe state must be a string, array, or object.",
  );
}

/**
 * Host-owned Decisions call. `apiKey` comes from the factory or
 * `OPENROUTER_API_KEY`, never from action input.
 */
export async function runTypeSafeDecision(
  options: RunTypeSafeDecisionOptions,
): Promise<TypeSafeEvaluateOutput> {
  const model = options.model ?? DEFAULT_TYPESAFE_MODEL;
  const client =
    options.client ??
    createOpenRouterDecisionsClient({
      apiKey: resolveOpenRouterApiKey(options.apiKey),
      model,
    });
  return client.evaluate({
    state: options.state,
    questions: options.questions,
    model,
  });
}
