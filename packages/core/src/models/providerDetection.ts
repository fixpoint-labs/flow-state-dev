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
  gateways?: Record<string, GatewayConfig>;
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

  // Phase 2: Check explicitly configured gateways
  if (config.gateways) {
    for (const [name, gwConfig] of Object.entries(config.gateways)) {
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
// Model ID parsing
// ---------------------------------------------------------------------------

/**
 * Parse 'provider:model-id' format.
 */
export function parseModelId(modelString: string): {
  provider: string;
  modelId: string;
} {
  const colonIndex = modelString.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(
      `Invalid model format: "${modelString}". Expected "provider:model-id" (e.g., "anthropic:claude-haiku").`
    );
  }
  return {
    provider: modelString.slice(0, colonIndex),
    modelId: modelString.slice(colonIndex + 1),
  };
}

/**
 * Convert our 'provider:model-id' format to the gateway 'provider/model-id' format.
 */
export function toGatewayModelId(
  provider: string,
  modelId: string
): string {
  return `${provider}/${modelId}`;
}
