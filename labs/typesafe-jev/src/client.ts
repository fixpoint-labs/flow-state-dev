/**
 * Evaluate transport. Tests inject a scripted client. Live calls go through
 * AI SDK `experimental_evaluate` (Gateway / Jev), not OpenRouter Decisions.
 */

import { TypeSafeError } from "./errors";
import { fromSdkResult, toSdkQuestions, type SdkEvaluateResult } from "./sdk-map";
import {
  DEFAULT_EVALUATE_MODEL,
  type TypeSafeEvaluateOutput,
  type TypeSafeQuestions,
  type TypeSafeState,
} from "./schemas";

/** Request shared by the evaluator, seams, and tests. */
export interface EvaluateRequest {
  state: TypeSafeState;
  questions: TypeSafeQuestions;
  model?: string;
}

/** Host-owned transport. Tests inject a scripted implementation. */
export interface EvaluateClient {
  evaluate(request: EvaluateRequest): Promise<TypeSafeEvaluateOutput>;
}

/** @deprecated Use EvaluateClient. */
export type TypeSafeDecisionsClient = EvaluateClient;

/** @deprecated Use EvaluateRequest. */
export type TypeSafeRequest = EvaluateRequest;

export type EvaluateFn = (args: {
  model: unknown;
  state: TypeSafeState;
  questions: ReturnType<typeof toSdkQuestions>;
}) => Promise<SdkEvaluateResult>;

export interface AiSdkEvaluateClientOptions {
  /** Evaluation model id or EvaluationModel. Defaults to `typesafe-ai/jev`. */
  model?: unknown;
  /**
   * Injected `experimental_evaluate`. Tests pass a scripted fn so CI
   * never hits the network. Live omits this and loads `ai`.
   */
  evaluate?: EvaluateFn;
}

/**
 * Client that calls AI SDK `experimental_evaluate`.
 */
export function createAiSdkEvaluateClient(
  options: AiSdkEvaluateClientOptions = {},
): EvaluateClient {
  const defaultModel = options.model ?? DEFAULT_EVALUATE_MODEL;

  return {
    async evaluate(request) {
      const model =
        defaultModel !== undefined && typeof defaultModel === "object"
          ? defaultModel
          : (request.model ?? defaultModel);
      const evaluateFn = options.evaluate ?? loadExperimentalEvaluate;
      try {
        const result = await evaluateFn({
          model,
          state: request.state,
          questions: toSdkQuestions(request.questions),
        });
        const modelId =
          typeof model === "string"
            ? model
            : request.model ??
              (model !== null &&
              typeof model === "object" &&
              "modelId" in model &&
              typeof (model as { modelId?: unknown }).modelId === "string"
                ? (model as { modelId: string }).modelId
                : DEFAULT_EVALUATE_MODEL);
        return fromSdkResult(request.questions, result, modelId);
      } catch (error) {
        if (error instanceof TypeSafeError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new TypeSafeError("http", `experimental_evaluate failed: ${message.slice(0, 500)}`);
      }
    },
  };
}

async function loadExperimentalEvaluate(
  args: Parameters<EvaluateFn>[0],
): Promise<SdkEvaluateResult> {
  const ai = await import("ai");
  const evaluate = (
    ai as { experimental_evaluate?: EvaluateFn }
  ).experimental_evaluate;
  if (evaluate === undefined) {
    throw new TypeSafeError(
      "http",
      "ai.experimental_evaluate is not available. The lab needs ai >= 7.0.105.",
    );
  }
  return evaluate(args);
}

/**
 * Resolve host-owned evaluate credentials. Action input is never consulted.
 */
export function resolveEvaluateApiKey(explicit?: string): string {
  const key =
    explicit ??
    process.env.AI_GATEWAY_API_KEY ??
    process.env.TYPESAFE_AI_API_KEY ??
    process.env.VERCEL_OIDC_TOKEN;
  if (key === undefined || key === "") {
    throw new TypeSafeError(
      "missing_api_key",
      "No evaluate credential is set. The host supplies AI_GATEWAY_API_KEY, TYPESAFE_AI_API_KEY, or VERCEL_OIDC_TOKEN; do not put it on action input.",
    );
  }
  return key;
}
