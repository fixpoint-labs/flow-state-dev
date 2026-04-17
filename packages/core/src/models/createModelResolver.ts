import { createRequire } from "node:module";
import type { GeneratorModel, ModelResolver } from "../types/model";
import type { RetryPolicy, GatewayConfig, ModelGroupDefaults } from "./types";
import type { ProviderAvailability } from "./providerDetection";
import { detectAvailableProviders, parseModelString } from "./providerDetection";
import { createFallbackModel } from "./fallbackModel";
import { wrapAiSdkModel } from "./createAiSdkModelResolver";
import { DEFAULT_PRESETS, type PresetConfig } from "./presets";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CreateModelResolverOptions {
  /** Explicit API keys. Overrides env var detection. */
  keys?: Partial<Record<string, string>>;
  /** Gateway configurations. */
  gateways?: Record<string, GatewayConfig>;
  /** Custom preset definitions. Merged with built-in presets. */
  presets?: Record<string, PresetConfig>;
  /** Retry policy for fallback arrays and presets. */
  retryPolicy?: RetryPolicy;
  /**
   * AI SDK provider instances. Keys are provider prefixes used in model strings.
   * If omitted, auto-creates providers from env vars.
   */
  providers?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_RETRY_POLICY: Required<RetryPolicy> = {
  maxAttemptsPerModel: 2,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

// ---------------------------------------------------------------------------
// Provider / gateway packages
// ---------------------------------------------------------------------------

const PROVIDER_PACKAGES: Record<string, { pkg: string; factory: string }> = {
  anthropic: { pkg: "@ai-sdk/anthropic", factory: "createAnthropic" },
  openai: { pkg: "@ai-sdk/openai", factory: "createOpenAI" },
  google: { pkg: "@ai-sdk/google", factory: "createGoogleGenerativeAI" },
};

const GATEWAY_PACKAGES: Record<string, { pkg: string; factory: string }> = {
  vercel: { pkg: "@ai-sdk/gateway", factory: "createGateway" },
  openrouter: { pkg: "@openrouter/ai-sdk-provider", factory: "createOpenRouter" },
};

const _require = createRequire(import.meta.url);
const _cwdRequire = createRequire(new URL(`file://${process.cwd()}/`));

function tryRequire(packageName: string): Record<string, unknown> | undefined {
  try {
    return _require(packageName);
  } catch {
    // Fallback: resolve from cwd (app root) for pnpm strict isolation
    try {
      return _cwdRequire(packageName);
    } catch {
      return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal provider loading
// ---------------------------------------------------------------------------

function loadProviderSync(
  providerName: string,
  apiKey: string
): (modelId: string) => unknown {
  const info = PROVIDER_PACKAGES[providerName];
  if (!info) {
    throw new Error(`Unknown provider: "${providerName}"`);
  }

  const mod = tryRequire(info.pkg);
  if (!mod || typeof mod[info.factory] !== "function") {
    throw new Error(
      `Provider package "${info.pkg}" is not installed. ` +
        `Install it to use ${providerName} models directly.`
    );
  }

  const factory = mod[info.factory] as (opts: { apiKey: string }) => unknown;
  return factory({ apiKey }) as (modelId: string) => unknown;
}

function loadGatewaySync(
  gatewayType: string,
  apiKey: string
): { gateway: Record<string, unknown>; type: string } {
  const info = GATEWAY_PACKAGES[gatewayType];
  if (!info) {
    throw new Error(`Unknown gateway type: "${gatewayType}"`);
  }

  const mod = tryRequire(info.pkg);
  if (!mod || typeof mod[info.factory] !== "function") {
    throw new Error(
      `Gateway package "${info.pkg}" is not installed. ` +
        `Install it to use the ${gatewayType} gateway.`
    );
  }

  const factory = mod[info.factory] as (opts: { apiKey: string }) => unknown;
  return {
    gateway: factory({ apiKey }) as Record<string, unknown>,
    type: gatewayType,
  };
}

// ---------------------------------------------------------------------------
// Internal: resolve explicit provider instances
// ---------------------------------------------------------------------------

type ProviderResolver = (modelId: string) => unknown;

function resolveExplicitProviders(
  providers: Record<string, unknown>
): Map<string, ProviderResolver> {
  const resolved = new Map<string, ProviderResolver>();

  for (const [name, provider] of Object.entries(providers)) {
    if (typeof provider === "function") {
      resolved.set(name, provider as ProviderResolver);
    } else if (
      provider &&
      typeof (provider as Record<string, unknown>).languageModel === "function"
    ) {
      resolved.set(name, (modelId: string) =>
        (provider as Record<string, Function>).languageModel(modelId)
      );
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a unified model resolver that auto-detects providers from env vars
 * and resolves model strings in `provider/model` format.
 *
 * Supports:
 * - `"provider/model"` — direct provider access (e.g., `"openai/gpt-5.4"`)
 * - `"gateway/provider/model"` — route through gateway (e.g., `"vercel/openai/gpt-5.4"`)
 * - `"preset/name"` — resolve a preset to a fallback model (e.g., `"preset/fast"`)
 */
export function createModelResolver(
  options?: CreateModelResolverOptions
): ModelResolver {
  const retryPolicy: Required<RetryPolicy> = {
    ...DEFAULT_RETRY_POLICY,
    ...options?.retryPolicy,
  };

  const allPresets: Record<string, PresetConfig> = {
    ...DEFAULT_PRESETS,
    ...options?.presets,
  };

  // Detect available providers from keys / env vars / gateways
  const availability = detectAvailableProviders({
    keys: options?.keys,
    gateways: options?.gateways,
  });

  // Resolve explicit provider instances if provided
  const explicitProviders = options?.providers
    ? resolveExplicitProviders(options.providers)
    : null;

  // Cache for resolved models
  const cache = new Map<string, GeneratorModel>();

  // Cache for auto-loaded provider resolvers (by provider name)
  const providerCache = new Map<string, ProviderResolver>();

  // Cache for auto-loaded gateway resolvers (by gateway type)
  const gatewayCache = new Map<string, { gateway: Record<string, unknown>; type: string }>();

  // Seed gateway cache with explicit instances from options.gateways[*].instance.
  // This bypasses dynamic loading via createRequire, which fails in bundled
  // Next.js/Webpack environments even when the package is externalized.
  if (options?.gateways) {
    for (const [, gwConfig] of Object.entries(options.gateways)) {
      if (gwConfig.instance !== undefined) {
        gatewayCache.set(gwConfig.type, {
          gateway: gwConfig.instance as Record<string, unknown>,
          type: gwConfig.type
        });
      }
    }
  }

  function getProviderResolver(providerName: string): ProviderResolver | undefined {
    // Check explicit providers first
    if (explicitProviders?.has(providerName)) {
      return explicitProviders.get(providerName)!;
    }

    // Check cache
    if (providerCache.has(providerName)) {
      return providerCache.get(providerName)!;
    }

    // Try to create from availability
    const info = availability.get(providerName);
    if (!info) return undefined;

    if (info.source === "key") {
      const resolver = loadProviderSync(providerName, info.apiKey!);
      providerCache.set(providerName, resolver);
      return resolver;
    }

    // Source is gateway — use gateway resolver for this provider
    return undefined;
  }

  function resolveViaGateway(
    gatewayType: string,
    apiKey: string,
    providerName: string,
    modelId: string
  ): unknown {
    if (!gatewayCache.has(gatewayType)) {
      gatewayCache.set(gatewayType, loadGatewaySync(gatewayType, apiKey));
    }
    const { gateway, type } = gatewayCache.get(gatewayType)!;
    const gatewayModelId = `${providerName}/${modelId}`;

    if (type === "openrouter") {
      return (gateway as any).chat(gatewayModelId);
    }
    return (gateway as any).languageModel(gatewayModelId);
  }

  function resolveSingleModel(modelString: string): GeneratorModel {
    const cached = cache.get(modelString);
    if (cached) return cached;

    const parsed = parseModelString(modelString);

    let model: GeneratorModel;

    if (parsed.type === "preset") {
      const preset = allPresets[parsed.presetName!];
      if (!preset) {
        const available = Object.keys(allPresets).join(", ");
        throw new Error(
          `Unknown preset "${parsed.presetName}". Available presets: ${available}`
        );
      }
      model = resolvePreset(parsed.presetName!, preset);
    } else if (parsed.type === "gateway") {
      // Explicit gateway path: gateway/provider/model
      const gwType = parsed.gateway!;
      const gwInfo = GATEWAY_PACKAGES[gwType];
      if (!gwInfo) {
        throw new Error(
          `Unknown gateway "${gwType}". Known gateways: ${Object.keys(GATEWAY_PACKAGES).join(", ")}`
        );
      }

      // Look up API key for the gateway
      const gwEnvVars: Record<string, string> = {
        vercel: "AI_GATEWAY_API_KEY",
        openrouter: "OPENROUTER_API_KEY",
      };
      const apiKey =
        options?.gateways?.[gwType]?.apiKey ??
        process.env[gwEnvVars[gwType] ?? ""] ??
        undefined;

      if (!apiKey) {
        throw new Error(
          `No API key found for gateway "${gwType}". ` +
            `Set ${gwEnvVars[gwType] ?? `the ${gwType} gateway API key`} environment variable.`
        );
      }

      const languageModel = resolveViaGateway(
        gwType,
        apiKey,
        parsed.provider!,
        parsed.modelId!
      );
      model = wrapAiSdkModel(languageModel, modelString);
    } else {
      // Direct: provider/model
      const providerName = parsed.provider!;
      const modelId = parsed.modelId!;

      // Try direct provider first
      const resolver = getProviderResolver(providerName);
      if (resolver) {
        const languageModel = resolver(modelId);
        model = wrapAiSdkModel(languageModel, modelString);
      } else {
        // Try gateway fallback
        const info = availability.get(providerName);
        if (info?.source === "gateway" && info.gatewayType && info.apiKey) {
          const languageModel = resolveViaGateway(
            info.gatewayType,
            info.apiKey,
            providerName,
            modelId
          );
          model = wrapAiSdkModel(languageModel, modelString);
        } else {
          throw new Error(
            `No provider available for "${providerName}". ` +
              `Set the appropriate API key or install the provider package.`
          );
        }
      }
    }

    cache.set(modelString, model);
    return model;
  }

  function resolvePreset(
    presetName: string,
    preset: PresetConfig
  ): GeneratorModel {
    const entries = preset.models
      .map((modelString) => {
        try {
          const parsed = parseModelString(modelString);
          const providerName = parsed.provider ?? "unknown";
          const model = resolveSingleModel(modelString);
          return { modelId: modelString, providerName, model };
        } catch {
          // Model not available — skip
          return null;
        }
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    return createFallbackModel({
      groupName: presetName,
      models: entries,
      defaults: preset.defaults,
      retryPolicy,
    });
  }

  return (modelId: string, _blockName?: string): GeneratorModel => {
    return resolveSingleModel(modelId);
  };
}
