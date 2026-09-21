/**
 * Shared evaluate call used by `evaluator`, the router, and the seams.
 * Prefer `experimental_evaluate` when the model can evaluate; otherwise
 * System 2 structured output. Not an FSD block — callers own composition.
 */

import { hasEvaluateCredentials, hasSystem2Credentials, isEvaluationCapable } from "./capability";
import {
  createAiSdkEvaluateClient,
  type EvaluateClient,
  type EvaluateFn,
} from "./client";
import { TypeSafeError } from "./errors";
import {
  DEFAULT_EVALUATE_MODEL,
  DEFAULT_SYSTEM2_MODEL,
  type TypeSafeEvaluateOutput,
  type TypeSafeQuestions,
  type TypeSafeState,
} from "./schemas";
import { system2Evaluate, type GenerateStructuredFn } from "./system-2";

export interface RunEvaluateOptions {
  state: TypeSafeState;
  questions: TypeSafeQuestions;
  /** Evaluate model, or a language-model id that trips System 2. */
  model?: unknown;
  /** Language-model id used only on the System 2 path. */
  fallbackModel?: string;
  /**
   * Force a path. Default: evaluate when `isEvaluationCapable(model)`,
   * else System 2.
   */
  mode?: "evaluate" | "system-2";
  /** Injected evaluate client. Tests use this so CI never hits the network. */
  client?: EvaluateClient;
  apiKey?: string;
  evaluate?: EvaluateFn;
  generate?: GenerateStructuredFn;
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

function modelId(model: unknown, fallback: string): string {
  return typeof model === "string" && model !== "" ? model : fallback;
}

function wantsEvaluate(options: RunEvaluateOptions): boolean {
  if (options.mode === "evaluate") return true;
  if (options.mode === "system-2") return false;
  return isEvaluationCapable(options.model ?? DEFAULT_EVALUATE_MODEL);
}

/**
 * Host-owned evaluate call. Credentials come from the factory or the
 * environment, never from action input.
 */
export async function runEvaluate(
  options: RunEvaluateOptions,
): Promise<TypeSafeEvaluateOutput> {
  if (options.client !== undefined) {
    return options.client.evaluate({
      state: options.state,
      questions: options.questions,
      model: modelId(options.model, DEFAULT_EVALUATE_MODEL),
    });
  }

  if (wantsEvaluate(options)) {
    if (
      typeof options.model !== "object" &&
      options.evaluate === undefined &&
      !hasEvaluateCredentials(options.apiKey)
    ) {
      throw new TypeSafeError(
        "missing_api_key",
        "No evaluate credential is set. The host supplies AI_GATEWAY_API_KEY, TYPESAFE_AI_API_KEY, or VERCEL_OIDC_TOKEN; do not put it on action input.",
      );
    }
    const client = createAiSdkEvaluateClient({
      model: options.model ?? DEFAULT_EVALUATE_MODEL,
      evaluate: options.evaluate,
    });
    return client.evaluate({
      state: options.state,
      questions: options.questions,
      model: modelId(options.model, DEFAULT_EVALUATE_MODEL),
    });
  }

  if (options.generate === undefined && !hasSystem2Credentials(options.apiKey)) {
    throw new TypeSafeError(
      "missing_api_key",
      "System 2 fallback needs a language-model credential (AI_GATEWAY_API_KEY or OPENAI_API_KEY). Jev is not required.",
    );
  }

  return system2Evaluate({
    state: options.state,
    questions: options.questions,
    model: options.fallbackModel ?? modelId(options.model, DEFAULT_SYSTEM2_MODEL),
    generate: options.generate,
  });
}

/** @deprecated Use runEvaluate. */
export const runTypeSafeDecision = runEvaluate;
