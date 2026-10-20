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
  "vercel:anthropic/claude-haiku-5.5",
  "vercel:anthropic/claude-sonnet-5.5",
  "vercel:anthropic/claude-opus-5.5",
  "vercel:openai/gpt-6-luna",
  "vercel:openai/gpt-6.1-sol",
  "vercel:openai/gpt-6-astra",
  "vercel:google/gemini-2.5-pro",
  "vercel:zai/glm-5.2",
  "vercel:xiaomi/mimo-v2.5",
  "vercel:moonshotai/kimi-k3",
] as const;

/**
 * The model `support.help`'s best fit asks which specialist answers a post.
 *
 * An evaluation model, not a chat model: best fit's one call is an
 * evaluator, and a chat model named here is refused when the call resolves.
 * Being an evaluation model it is also untouched by the dev override that
 * forces every generator onto the cheap model. Test mode scripts the call by
 * its block name, `coordinator-route`, and never reaches this model.
 */
export const ROUTE_MODEL = "vercel:typesafe-ai/jev";

/** Union of accepted gateway model strings for the kitchen-sink. */
export type KitchenSinkModel = (typeof KITCHEN_SINK_MODELS)[number];

/** Default model selection when a user has no stored preference. */
export const DEFAULT_KITCHEN_SINK_MODEL: KitchenSinkModel =
  "vercel:anthropic/claude-sonnet-5.5";

/** True when `value` is a current catalog model id. */
export function isKitchenSinkModel(value: string): value is KitchenSinkModel {
  return (KITCHEN_SINK_MODELS as readonly string[]).includes(value);
}

/** Saved ids in the removed slash spelling already logged by this process. */
const loggedSlashIds = new Set<string>();

/**
 * Resolve a persisted or client-provided model id to a catalog entry.
 * Unknown or removed catalog ids fall back to {@link DEFAULT_KITCHEN_SINK_MODEL}.
 * A saved three-slash id falls back the same way and is logged once; it is never rewritten.
 */
export function coalesceKitchenSinkModel(
  value: string | null | undefined,
): KitchenSinkModel {
  if (value != null && isKitchenSinkModel(value)) {
    return value;
  }
  if (value != null && value.split("/").length >= 3 && !loggedSlashIds.has(value)) {
    loggedSlashIds.add(value);
    console.warn(
      `[kitchen-sink] saved model "${value}" uses the removed slash spelling; ` +
        `using the default "${DEFAULT_KITCHEN_SINK_MODEL}" instead.`,
    );
  }
  return DEFAULT_KITCHEN_SINK_MODEL;
}

/** Friendly labels and descriptions used by the selector dropdown. */
export const MODEL_LABELS: Record<
  KitchenSinkModel,
  { label: string; description: string }
> = {
  "vercel:anthropic/claude-haiku-5.5": {
    label: "Claude Haiku 5.5",
    description: "Fast, low cost",
  },
  "vercel:anthropic/claude-sonnet-5.5": {
    label: "Claude Sonnet 5.5",
    description: "Balanced default",
  },
  "vercel:anthropic/claude-opus-5.5": {
    label: "Claude Opus 5.5",
    description: "Highest capability",
  },
  "vercel:openai/gpt-6-luna": {
    label: "GPT-6 Luna",
    description: "Fast, low cost",
  },
  "vercel:openai/gpt-6.1-sol": {
    label: "GPT-6.1 Sol",
    description: "Balanced",
  },
  "vercel:openai/gpt-6-astra": {
    label: "GPT-6 Astra",
    description: "Highest capability",
  },
  "vercel:google/gemini-2.5-pro": {
    label: "Gemini 2.5 Pro",
    description: "Long context",
  },
  "vercel:zai/glm-5.2": {
    label: "GLM 5.2",
    description: "Open-weight, strong coding",
  },
  "vercel:xiaomi/mimo-v2.5": {
    label: "MiMo V2.5",
    description: "Open-weight, efficient reasoning",
  },
  "vercel:moonshotai/kimi-k3": {
    label: "Kimi K3",
    description: "Open-weight, agentic long context",
  },
};
