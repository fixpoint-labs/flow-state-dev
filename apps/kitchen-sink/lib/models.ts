/**
 * Kitchen-sink model catalog.
 *
 * Single source of truth for the concrete Vercel AI Gateway model strings
 * exposed in the kitchen-sink model selector. The chat-agent flow stores
 * the user's selection in user state and passes it directly to the
 * generator's `model` slot — the resolver returns a Vercel-gateway-backed
 * `LanguageModel` instance for any of these strings.
 */

/** Gateway model strings shown in the kitchen-sink model selector. */
export const KITCHEN_SINK_MODELS = [
  "vercel/anthropic/claude-haiku-4.5",
  "vercel/anthropic/claude-sonnet-4.6",
  "vercel/anthropic/claude-opus-4.7",
  "vercel/openai/gpt-5.4-nano",
  "vercel/openai/gpt-5.5",
  "vercel/openai/gpt-5.4-mini",
  "vercel/google/gemini-2.5-pro",
  "vercel/zai/glm-5.2",
] as const;

/** Union of accepted gateway model strings for the kitchen-sink. */
export type KitchenSinkModel = (typeof KITCHEN_SINK_MODELS)[number];

/** Default model selection when a user has no stored preference. */
export const DEFAULT_KITCHEN_SINK_MODEL: KitchenSinkModel =
  "vercel/anthropic/claude-sonnet-4.6";

/** Friendly labels and descriptions used by the selector dropdown. */
export const MODEL_LABELS: Record<
  KitchenSinkModel,
  { label: string; description: string }
> = {
  "vercel/anthropic/claude-haiku-4.5": {
    label: "Claude Haiku 4.5",
    description: "Fast, low cost",
  },
  "vercel/anthropic/claude-sonnet-4.6": {
    label: "Claude Sonnet 4.6",
    description: "Balanced default",
  },
  "vercel/anthropic/claude-opus-4.7": {
    label: "Claude Opus 4.7",
    description: "Highest capability",
  },
  "vercel/openai/gpt-5.4-nano": {
    label: "GPT-5.5 Nano",
    description: "Fast, low cost",
  },
  "vercel/openai/gpt-5.5": {
    label: "GPT-5.5",
    description: "Balanced",
  },
  "vercel/openai/gpt-5.4-mini": {
    label: "GPT-5.5 Mini",
    description: "Mid-tier",
  },
  "vercel/google/gemini-2.5-pro": {
    label: "Gemini 2.5 Pro",
    description: "Long context",
  },
  "vercel/zai/glm-5.2": {
    label: "GLM 5.2",
    description: "Open-weight, strong coding",
  },
};
