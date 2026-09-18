/**
 * OpenRouter Decisions client for Jev / System One.
 *
 * Native TypeSafe is `POST https://api.typesafe.ai/v1/systemone` with
 * `{ state, model, questions }`. OpenRouter documents the same payload on
 * `POST https://openrouter.ai/api/alpha/decisions` with model
 * `~typesafe/jev-latest` (or a pinned `typesafe/jev-*`). Chat completions
 * are the wrong shape — Jev does not generate text.
 */

import { TypeSafeError } from "./errors";
import {
  DEFAULT_TYPESAFE_MODEL,
  OPENROUTER_DECISIONS_URL,
  evaluateOutputSchema,
  type TypeSafeEvaluateOutput,
  type TypeSafeQuestions,
  type TypeSafeState,
} from "./schemas";

/** Request body shared by native TypeSafe and OpenRouter Decisions. */
export interface TypeSafeRequest {
  state: TypeSafeState;
  questions: TypeSafeQuestions;
  model?: string;
}

/** Host-owned transport. Tests inject a scripted implementation. */
export interface TypeSafeDecisionsClient {
  evaluate(request: TypeSafeRequest): Promise<TypeSafeEvaluateOutput>;
}

export interface OpenRouterDecisionsClientOptions {
  /** Host-owned. Never taken from action input. */
  apiKey: string;
  url?: string;
  model?: string;
  fetch?: typeof fetch;
  referer?: string;
  title?: string;
}

const DEFAULT_REFERER = "https://github.com/fixpoint-labs/flow-state-dev";
const DEFAULT_TITLE = "flow-state-dev typesafe-jev POC";

/**
 * POST to OpenRouter's Decisions API. Auth is the OpenRouter key.
 */
export function createOpenRouterDecisionsClient(
  options: OpenRouterDecisionsClientOptions,
): TypeSafeDecisionsClient {
  const fetchImpl = options.fetch ?? fetch;
  const url = options.url ?? OPENROUTER_DECISIONS_URL;
  const defaultModel = options.model ?? DEFAULT_TYPESAFE_MODEL;

  return {
    async evaluate(request) {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": options.referer ?? DEFAULT_REFERER,
          "X-OpenRouter-Title": options.title ?? DEFAULT_TITLE,
        },
        body: JSON.stringify({
          model: request.model ?? defaultModel,
          state: request.state,
          questions: request.questions,
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        throw new TypeSafeError(
          "http",
          `OpenRouter Decisions ${res.status}: ${text.slice(0, 500)}`,
          { status: res.status, body: text },
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new TypeSafeError("invalid_response", "OpenRouter Decisions returned non-JSON.", {
          body: text.slice(0, 500),
        });
      }

      const checked = evaluateOutputSchema.safeParse(parsed);
      if (!checked.success) {
        throw new TypeSafeError(
          "invalid_response",
          `OpenRouter Decisions body failed the TypeSafe answer schema: ${checked.error.message}`,
          { body: text.slice(0, 500) },
        );
      }
      return checked.data;
    },
  };
}

/**
 * Resolve the host-owned OpenRouter key. Action input is never consulted.
 */
export function resolveOpenRouterApiKey(explicit?: string): string {
  const key = explicit ?? process.env.OPENROUTER_API_KEY;
  if (key === undefined || key === "") {
    throw new TypeSafeError(
      "missing_api_key",
      "OPENROUTER_API_KEY is not set. The host supplies it from the environment; do not put it on action input.",
    );
  }
  return key;
}
