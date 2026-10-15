import { providerNames, type GatewayConfig } from "./types";

// ---------------------------------------------------------------------------
// Standard env var mappings
// ---------------------------------------------------------------------------

/** Env-var name that supplies the API key for each built-in provider. */
export const PROVIDER_ENV_VARS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

/** Env-var name that supplies the API key for each known gateway. */
export const GATEWAY_ENV_VARS: Record<string, string> = {
  vercel: "AI_GATEWAY_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderAvailability {
  provider: string;
  source: "key" | "gateway";
  apiKey?: string;
  gatewayType?: string;
  gatewayName?: string;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect which providers are available based on:
 * 1. Explicit keys (highest priority)
 * 2. Environment variables for direct provider keys
 * 3. Gateway keys (Vercel AI Gateway, OpenRouter) — make all providers available
 *
 * Accepts an optional `env` parameter for testing (defaults to `process.env`).
 */
export function detectAvailableProviders(config: {
  keys?: Partial<Record<string, string>>;
  gateways?: Record<string, GatewayConfig | unknown>;
  env?: Record<string, string | undefined>;
}): Map<string, ProviderAvailability> {
  const env = config.env ?? process.env;
  const available = new Map<string, ProviderAvailability>();

  // Phase 1: Check direct provider keys (explicit config + env vars)
  for (const [provider, envVar] of Object.entries(PROVIDER_ENV_VARS)) {
    const key = config.keys?.[provider] ?? env[envVar];
    if (key) {
      available.set(provider, { provider, source: "key", apiKey: key });
    }
  }

  // Phase 2: Check explicitly configured gateways.
  // Entries can be GatewayConfig objects ({ type, apiKey }) or raw instances
  // (objects with languageModel/chat methods). Raw instances make all
  // gateway-supported providers available without needing an API key here
  // (the key is already baked into the instance).
  if (config.gateways) {
    for (const [name, entry] of Object.entries(config.gateways)) {
      const isConfig = typeof entry === "object" && entry !== null && "type" in entry && typeof (entry as GatewayConfig).type === "string";

      if (isConfig) {
        const gwConfig = entry as GatewayConfig;
        const envVar = GATEWAY_ENV_VARS[gwConfig.type];
        const key = gwConfig.apiKey ?? (envVar ? env[envVar] : undefined);
        if (!key) continue;

        for (const provider of providerNames) {
          if (!available.has(provider)) {
            available.set(provider, {
              provider,
              source: "gateway",
              apiKey: key,
              gatewayType: gwConfig.type,
              gatewayName: name,
            });
          }
        }
      } else if (entry !== null && entry !== undefined) {
        // Raw gateway instance — mark all providers as available
        for (const provider of providerNames) {
          if (!available.has(provider)) {
            available.set(provider, {
              provider,
              source: "gateway",
              apiKey: "",
              gatewayType: name,
              gatewayName: name,
            });
          }
        }
      }
    }
  }

  // Phase 3: Auto-detect gateways from env vars (even if not explicitly configured).
  // This enables zero-config on Vercel deployments.
  for (const [gwType, envVar] of Object.entries(GATEWAY_ENV_VARS)) {
    const key = env[envVar];
    if (!key) continue;

    for (const provider of providerNames) {
      if (!available.has(provider)) {
        available.set(provider, {
          provider,
          source: "gateway",
          apiKey: key,
          gatewayType: gwType,
          gatewayName: `auto-${gwType}`,
        });
      }
    }
  }

  return available;
}

// ---------------------------------------------------------------------------
// Model string parsing
// ---------------------------------------------------------------------------

/** A model string split into a lane. Whether an alias is a gateway or a provider is the resolver's call. */
export type ParsedModelString =
  | {
      type: "direct";
      /** Provider name (e.g., "openai"). */
      provider: string;
      /** The part after the slash (`gpt-6.1-sol`). */
      modelId: string;
    }
  | {
      type: "alias";
      /** The route name before the first colon (e.g., "vercel", "triage"). */
      alias: string;
      /** Everything after the first colon, untouched (`anthropic/claude-sonnet-5-5`). */
      modelId: string;
    }
  | {
      type: "intent";
      /** Intent name (e.g., "utility"). */
      intentName: string;
    };

/** Allowed shape for intent names referenced via `intent/<name>`. */
export const INTENT_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * Canonicalize an intent name into the suffix used in `FSDEV_INTENT_<NAME>`
 * environment-variable overrides: uppercased, with hyphens replaced by
 * underscores. Two distinct intent names that produce the same canonical
 * form (`my-custom` and `my_custom`) will collide as env-var overrides;
 * `createModelResolver` rejects such configurations at construction.
 */
export function canonicalizeIntentName(intentName: string): string {
  return intentName.toUpperCase().replace(/-/g, "_");
}

/**
 * Parse a model string into its lane: `provider/model`, `intent/name`, or
 * `name:model` (first `:` before the first `/`, so `openai/gpt-oss:free` stays
 * a slash id). The removed `gateway/provider/model` form throws, naming its
 * colon spelling.
 */
export function parseModelString(modelString: string): ParsedModelString {
  const trimmed = modelString.trim();
  if (trimmed.length === 0) {
    throw new Error("Model string cannot be empty.");
  }

  const colon = trimmed.indexOf(":");
  const slash = trimmed.indexOf("/");
  if (colon !== -1 && (slash === -1 || colon < slash)) {
    const alias = trimmed.slice(0, colon);
    const modelId = trimmed.slice(colon + 1);
    if (alias.length === 0 || modelId.length === 0) {
      throw new Error(
        `Invalid model format: "${modelString}". ` +
          `A named route needs a name and a model id, e.g. "vercel:openai/gpt-6.1-sol" or "openai:gpt-6.1-sol".`
      );
    }
    return { type: "alias", alias, modelId };
  }

  const parts = trimmed.split("/");

  if (parts.length === 2) {
    if (parts[0] === "intent") {
      const name = parts[1];
      if (!INTENT_NAME_REGEX.test(name)) {
        throw new Error(
          `Invalid intent name: "${name}". Intent names must match ${INTENT_NAME_REGEX.source}.`
        );
      }
      return { type: "intent", intentName: name };
    }
    return { type: "direct", provider: parts[0], modelId: parts[1] };
  }

  if (parts.length >= 3) {
    if (parts[0] === "intent") {
      throw new Error(
        `Invalid model format: "${modelString}". intent/* model strings must be 2 parts (intent/name).`
      );
    }
    const renamed = `${parts[0]}:${parts.slice(1).join("/")}`;
    throw new Error(
      `Invalid model format: "${modelString}". The "gateway/provider/model" form was removed; ` +
        `name the route with a colon: "${renamed}".`
    );
  }

  throw new Error(
    `Invalid model format: "${modelString}". ` +
      `Expected "provider/model" (e.g., "openai/gpt-6.1-sol") or a named route ` +
      `"name:model" (e.g., "vercel:openai/gpt-6.1-sol").`
  );
}

/**
 * Provider name with no app config. A named route uses the model id's first
 * slash segment, else the name itself. `"unknown"` for an intent or a bad
 * string. Use it only without a resolver: `ModelResolver.providerOf`
 * classifies against the app's maps, and agrees with this on every string
 * whose route does not depend on them.
 */
export function extractProviderName(modelString: string): string {
  try {
    const parsed = parseModelString(modelString);
    if (parsed.type === "intent") return "unknown";
    if (parsed.type === "alias") {
      const slash = parsed.modelId.indexOf("/");
      return slash > 0 ? parsed.modelId.slice(0, slash) : parsed.alias;
    }
    return parsed.provider;
  } catch {
    return "unknown";
  }
}
