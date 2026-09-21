/**
 * Optional = model capability, not package mount.
 *
 * Jev / Gateway evaluate models implement `experimental_evaluate`.
 * A language model does not — the evaluator falls back to System 2
 * structured output with the same question intent.
 */

export type EvaluateMode = "evaluate" | "system-2";

/**
 * True when `model` can go through AI SDK `experimental_evaluate`.
 *
 * Objects with `doEvaluate` are evaluation models (including mocks).
 * String ids that name Jev / TypeSafe evaluate models count too.
 */
export function isEvaluationCapable(model: unknown): boolean {
  if (model !== null && typeof model === "object" && "doEvaluate" in model) {
    return true;
  }
  if (typeof model !== "string" || model === "") return false;
  const id = model.toLowerCase();
  if (id === "typesafe-ai/jev" || id.startsWith("typesafe-ai/jev")) return true;
  if (id.startsWith("jev")) return true;
  if (id.includes("typesafe") && id.includes("jev")) return true;
  return false;
}

/**
 * Host-owned evaluate credentials. Never read from action input.
 */
export function hasEvaluateCredentials(explicit?: string): boolean {
  if (explicit !== undefined && explicit !== "") return true;
  return Boolean(
    process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN ||
      process.env.TYPESAFE_AI_API_KEY,
  );
}

/**
 * Host-owned language-model credentials for the System 2 fallback.
 */
export function hasSystem2Credentials(explicit?: string): boolean {
  if (explicit !== undefined && explicit !== "") return true;
  return Boolean(
    process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN ||
      process.env.OPENAI_API_KEY,
  );
}
