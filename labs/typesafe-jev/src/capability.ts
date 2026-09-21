/**
 * Optional = model capability, not package mount.
 *
 * Anything `experimental_evaluate` accepts is evaluate-capable: a Gateway
 * / registry string, or an evaluation model instance (`doEvaluate`).
 * OpenAI / Anthropic / Google use the provider `evaluationModel(...)`
 * adapter on that same API. There is no FSD generator+Zod shim.
 */

import { TypeSafeError } from "./errors";
import { DEFAULT_EVALUATE_MODEL } from "./schemas";

/**
 * True when `model` can be passed to AI SDK `experimental_evaluate`.
 *
 * Objects with `doEvaluate` are evaluation models (Jev, provider
 * adapters, mocks). Non-empty strings resolve through Gateway or the
 * configured default evaluation provider. Language-model objects
 * without `doEvaluate` are not evaluation models.
 */
export function isEvaluationCapable(model: unknown): boolean {
  if (model !== null && typeof model === "object" && "doEvaluate" in model) {
    return true;
  }
  return typeof model === "string" && model !== "";
}

/**
 * Prefer Jev. Pass through evaluation model instances and evaluate IDs.
 * Does not swap models and does not fall back to generateObject.
 */
export function resolveEvaluateModel(model: unknown): unknown {
  if (model === undefined || model === null || model === "") {
    return DEFAULT_EVALUATE_MODEL;
  }
  if (!isEvaluationCapable(model)) {
    throw new TypeSafeError(
      "unsupported_model",
      "evaluator needs an evaluation model instance or an evaluate model id. Use typesafe-ai/jev or a provider evaluationModel(...). Do not pass a generate-only language model.",
    );
  }
  return model;
}

/**
 * Host-owned evaluate credentials for string / Gateway ids.
 * Evaluation model instances carry their own provider credentials.
 * Never read from action input.
 */
export function hasEvaluateCredentials(explicit?: string): boolean {
  if (explicit !== undefined && explicit !== "") return true;
  return Boolean(
    process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN ||
      process.env.TYPESAFE_AI_API_KEY,
  );
}
