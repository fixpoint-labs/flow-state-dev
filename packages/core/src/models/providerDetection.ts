import type { GatewayConfig } from "./types";

// ---------------------------------------------------------------------------
// Standard env var mappings
// ---------------------------------------------------------------------------

const DEFAULT_ENV_VARS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

const GATEWAY_ENV_VARS: Record<string, string> = {
  vercel: "AI_GATEWAY_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/** All major providers that gateways support. */
const GATEWAY_SUPPORTED_PROVIDERS = ["anthropic", "openai", "google"] as const;

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
  for (const [provider, envVar] of Object.entries(DEFAULT_ENV_VARS)) {
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

        for (const provider of GATEWAY_SUPPORTED_PROVIDERS) {
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
        for (const provider of GATEWAY_SUPPORTED_PROVIDERS) {
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

    for (const provider of GATEWAY_SUPPORTED_PROVIDERS) {
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

export interface ParsedModelString {
  /** "direct" = provider/model, "gateway" = gateway/provider/model, "intent" = intent/name */
  type: "direct" | "gateway" | "intent";
  /** Provider name (e.g., "openai"). Present for direct and gateway types. */
  provider?: string;
  /** Model ID (e.g., "gpt-5.4"). Present for direct and gateway types. */
  modelId?: string;
  /** Gateway name (e.g., "vercel"). Only present for gateway type. */
  gateway?: string;
  /** Intent name (e.g., "utility"). Only present for intent type. */
  intentName?: string;
}

const PRESET_MIGRATION_MESSAGE =
  "preset/* model strings have been removed. Migrate to intent/<name> via\n" +
  "createModelResolver({ intents }). Common mappings:\n" +
  "  preset/fast, preset/tiny, preset/small  → intent/utility\n" +
  "  preset/medium                           → intent/chat\n" +
  "  preset/large                            → intent/code or intent/reason\n" +
  "  preset/thinking-*                       → intent/reason or intent/plan\n" +
  "                                            with reasoning enabled (FIX-517)\n" +
  "See https://linear.app/.../fix-512 for context.";

/** Allowed shape for intent names referenced via `intent/<name>`. */
export const INTENT_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * Parse a model string into its components.
 *
 * Supported formats:
 * - `"provider/model"` → direct provider access
 * - `"gateway/provider/model"` → route through a gateway
 * - `"intent/name"` → resolve a named intent (configured via createModelResolver)
 *
 * `preset/*` strings are no longer supported and throw a migration error.
 */
export function parseModelString(modelString: string): ParsedModelString {
  const trimmed = modelString.trim();
  if (trimmed.length === 0) {
    throw new Error("Model string cannot be empty.");
  }

  const parts = trimmed.split("/");

  if (parts.length === 2) {
    if (parts[0] === "preset") {
      throw new Error(PRESET_MIGRATION_MESSAGE);
    }
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

  if (parts.length === 3) {
    if (parts[0] === "intent" || parts[0] === "preset") {
      if (parts[0] === "preset") {
        throw new Error(PRESET_MIGRATION_MESSAGE);
      }
      throw new Error(
        `Invalid model format: "${modelString}". intent/* model strings must be 2 parts (intent/name).`
      );
    }
    return {
      type: "gateway",
      gateway: parts[0],
      provider: parts[1],
      modelId: parts[2],
    };
  }

  throw new Error(
    `Invalid model format: "${modelString}". ` +
      `Expected "provider/model" (e.g., "openai/gpt-5.4") or ` +
      `"gateway/provider/model" (e.g., "vercel/openai/gpt-5.4").`
  );
}

/**
 * Extract the provider segment from a model string. For direct strings this
 * is `parts[0]`; for gateway strings it is the inner provider segment
 * (`parts[1]`). Returns `"unknown"` for malformed strings or intent strings.
 */
export function extractProviderName(modelString: string): string {
  try {
    const parsed = parseModelString(modelString);
    if (parsed.type === "intent") return "unknown";
    return parsed.provider ?? "unknown";
  } catch {
    return "unknown";
  }
}
