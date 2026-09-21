/**
 * Shared evaluate call used by `evaluator`, the router, and the seams.
 * Thin wrap of AI SDK `experimental_evaluate`. Prefer Jev. Accept any
 * evaluation-capable model string or instance. No generator+Zod shim.
 */

import { hasEvaluateCredentials, isEvaluationCapable, resolveEvaluateModel } from "./capability";
import {
  createAiSdkEvaluateClient,
  type EvaluateClient,
  type EvaluateFn,
} from "./client";
import { TypeSafeError } from "./errors";
import { DEFAULT_EVALUATE_MODEL, type TypeSafeEvaluateOutput, type TypeSafeQuestions, type TypeSafeState } from "./schemas";

export interface RunEvaluateOptions {
  state: TypeSafeState;
  questions: TypeSafeQuestions;
  /**
   * Evaluation model: Gateway / registry string (`typesafe-ai/jev`) or
   * an `evaluationModel(...)` instance. Default is Jev.
   */
  model?: unknown;
  /** Injected evaluate client. Tests use this so CI never hits the network. */
  client?: EvaluateClient;
  apiKey?: string;
  evaluate?: EvaluateFn;
}

/**
 * Coerce a block input into evaluate `state` (string, array, or object).
 */
export function asTypeSafeState(input: unknown): TypeSafeState {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) return input;
  if (input !== null && typeof input === "object") {
    return input as Record<string, unknown>;
  }
  throw new TypeSafeError(
    "invalid_state",
    "Evaluate state must be a string, array, or object.",
  );
}

function modelLabel(model: unknown): string {
  if (typeof model === "string" && model !== "") return model;
  if (model !== null && typeof model === "object" && "modelId" in model) {
    const id = (model as { modelId?: unknown }).modelId;
    if (typeof id === "string" && id !== "") return id;
  }
  return DEFAULT_EVALUATE_MODEL;
}

/**
 * Host-owned evaluate call. Credentials come from the factory or the
 * environment, never from action input.
 */
export async function runEvaluate(
  options: RunEvaluateOptions,
): Promise<TypeSafeEvaluateOutput> {
  const model = resolveEvaluateModel(options.model);

  if (options.client !== undefined) {
    return options.client.evaluate({
      state: options.state,
      questions: options.questions,
      model: modelLabel(model),
    });
  }

  const needsHostKey =
    options.evaluate === undefined &&
    typeof model !== "object" &&
    !hasEvaluateCredentials(options.apiKey);
  if (needsHostKey) {
    throw new TypeSafeError(
      "missing_api_key",
      "No evaluate credential is set. The host supplies AI_GATEWAY_API_KEY, TYPESAFE_AI_API_KEY, or VERCEL_OIDC_TOKEN for Gateway strings; evaluationModel instances use the provider's own key. Do not put it on action input.",
    );
  }

  const client = createAiSdkEvaluateClient({
    model,
    evaluate: options.evaluate,
  });
  return client.evaluate({
    state: options.state,
    questions: options.questions,
    model: modelLabel(model),
  });
}

/** @deprecated Use runEvaluate. */
export const runTypeSafeDecision = runEvaluate;

export { isEvaluationCapable };
