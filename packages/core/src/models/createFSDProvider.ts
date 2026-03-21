import { createRequire } from "node:module";
import type { GeneratorModel } from "../types/model";
import type {
  FSDProviderConfig,
  FSDProvider,
  ModelGroupConfig,
  RetryPolicy,
} from "./types";
import type { ProviderAvailability } from "./providerDetection";
import {
  detectAvailableProviders,
  parseModelString,
} from "./providerDetection";
import { createFallbackModel } from "./fallbackModel";
import { wrapAiSdkModel } from "./createAiSdkModelResolver";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_RETRY_POLICY: Required<RetryPolicy> = {
  maxAttemptsPerModel: 2,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * Built-in default groups. Sensible starting point.
 * Users can spread and override: `groups: { ...defaultGroups, fast: { ... } }`.
 */
export const defaultGroups: Record<string, ModelGroupConfig> = {
  fast: {
    models: [
      "anthropic/claude-sonnet-4-6",
      "openai/gpt-5.4-mini",
      "google/gemini-3-flash",
    ],
    defaults: { maxTokens: 1024 },
  },
  thinking: {
    models: [
      "anthropic/claude-opus-4-6",
      "openai/gpt-5.4",
      "google/gemini-3.1-pro-preview",
    ],
    defaults: {
      providerOptions: {
        anthropic: { thinking: { budgetTokens: 10000 } },
      },
    },
  },
  balanced: {
    models: [
      "anthropic/claude-sonnet-4-6",
      "openai/gpt-5.4",
      "google/gemini-3-flash",
    ],
  },
};

// ---------------------------------------------------------------------------
// Provider resolver types
// ---------------------------------------------------------------------------

/**
 * A callable that creates an AI SDK language model from a provider name and
 * model ID. Gateways need both pieces to construct 'provider/model' format;
 * direct providers only need modelId.
 */
type ProviderResolver = (
  providerName: string,
  modelId: string
) => unknown;

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/**
 * Creates an FSD provider that maps group names to fallback GeneratorModels.
 *
 * Usage:
 * ```ts
 * const provider = createFSDProvider({ groups: defaultGroups });
 * const gen = generator({ model: provider('fast') });
 * ```
 */
export function createFSDProvider(config: FSDProviderConfig): FSDProvider {
  const retryPolicy: Required<RetryPolicy> = {
    ...DEFAULT_RETRY_POLICY,
    ...config.retryPolicy,
  };

  // Detect available providers (direct keys + gateways)
  const availability = detectAvailableProviders({
    keys: config.keys,
    gateways: config.gateways,
  });

  // Resolve AI SDK provider instances
  const aiSdkProviders = resolveAiSdkProviders(
    config.providers,
    availability
  );

  // Build group cache (lazy — resolved on first access)
  const groupCache = new Map<string, GeneratorModel>();

  function resolveGroup(groupName: string): GeneratorModel {
    const cached = groupCache.get(groupName);
    if (cached) return cached;

    const group = config.groups[groupName];
    if (!group) {
      const available = Object.keys(config.groups).join(", ");
      throw new Error(
        `Unknown model group "${groupName}". Available groups: ${available}`
      );
    }

    // Filter to available models and wrap as GeneratorModel
    const availableModels = group.models
      .map((modelString) => {
        const parsed = parseModelString(modelString);
        const providerName = parsed.provider!;
        const modelId = parsed.modelId!;
        const resolver = aiSdkProviders.get(providerName);
        if (!resolver) return null;

        try {
          const languageModel = resolver(providerName, modelId);
          return {
            modelId: modelString,
            providerName,
            model: wrapAiSdkModel(languageModel, modelString),
          };
        } catch {
          // Provider package not installed or model creation failed — skip
          return null;
        }
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    const fallbackModel = createFallbackModel({
      groupName,
      models: availableModels,
      defaults: group.defaults,
      retryPolicy,
    });

    groupCache.set(groupName, fallbackModel);
    return fallbackModel;
  }

  // Create the callable provider
  const provider = function (groupName: string): GeneratorModel {
    return resolveGroup(groupName);
  } as FSDProvider;

  provider.languageModel = resolveGroup;

  provider.groups = () => Object.keys(config.groups);

  provider.available = (groupName: string) => {
    const group = config.groups[groupName];
    if (!group) return [];
    return group.models.filter((modelString) => {
      const parsed = parseModelString(modelString);
      return parsed.provider ? aiSdkProviders.has(parsed.provider) : false;
    });
  };

  return provider;
}

// ---------------------------------------------------------------------------
// Internal: resolve AI SDK provider instances
// ---------------------------------------------------------------------------

function resolveAiSdkProviders(
  explicitProviders: Record<string, unknown> | undefined,
  availability: Map<string, ProviderAvailability>
): Map<string, ProviderResolver> {
  const resolved = new Map<string, ProviderResolver>();

  if (explicitProviders) {
    // User passed provider instances directly
    for (const [name, provider] of Object.entries(explicitProviders)) {
      if (typeof provider === "function") {
        resolved.set(
          name,
          (_prov: string, modelId: string) => (provider as Function)(modelId)
        );
      } else if (
        provider &&
        typeof (provider as Record<string, unknown>).languageModel ===
          "function"
      ) {
        resolved.set(
          name,
          (_prov: string, modelId: string) =>
            (provider as Record<string, Function>).languageModel(modelId)
        );
      }
    }
    return resolved;
  }

  // Auto-create providers from detected availability
  for (const [providerName, info] of availability.entries()) {
    if (resolved.has(providerName)) continue;

    if (info.source === "key") {
      resolved.set(
        providerName,
        createDirectProviderResolver(providerName, info.apiKey!)
      );
    } else if (info.source === "gateway") {
      resolved.set(
        providerName,
        createGatewayProviderResolver(info.gatewayType!, info.apiKey!)
      );
    }
  }

  return resolved;
}

function createDirectProviderResolver(
  providerName: string,
  apiKey: string
): ProviderResolver {
  let cached: ((modelId: string) => unknown) | null = null;

  return (_prov: string, modelId: string) => {
    if (!cached) {
      cached = loadProviderSync(providerName, apiKey);
    }
    return cached(modelId);
  };
}

/**
 * Map of provider name → package name and factory export name.
 * Used for dynamic import of optional peer dependencies.
 */
const PROVIDER_PACKAGES: Record<
  string,
  { pkg: string; factory: string }
> = {
  anthropic: { pkg: "@ai-sdk/anthropic", factory: "createAnthropic" },
  openai: { pkg: "@ai-sdk/openai", factory: "createOpenAI" },
  google: { pkg: "@ai-sdk/google", factory: "createGoogleGenerativeAI" },
};

const GATEWAY_PACKAGES: Record<
  string,
  { pkg: string; factory: string }
> = {
  vercel: { pkg: "@ai-sdk/gateway", factory: "createGateway" },
  openrouter: { pkg: "@openrouter/ai-sdk-provider", factory: "createOpenRouter" },
};

/**
 * Dynamically import a package at runtime without bundler interference.
 *
 * Uses `createRequire` from `node:module` so the specifier is opaque to
 * webpack/turbopack static analysis. This prevents Next.js builds from
 * failing when an optional peer dependency is not installed.
 */
const _require = createRequire(import.meta.url);

function tryRequire(packageName: string): Record<string, unknown> | undefined {
  try {
    return _require(packageName);
  } catch {
    return undefined;
  }
}

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

function createGatewayProviderResolver(
  gatewayType: string,
  apiKey: string
): ProviderResolver {
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
  const gw = factory({ apiKey }) as Record<string, unknown>;

  if (gatewayType === "openrouter") {
    return (providerName: string, modelId: string) =>
      (gw as any).chat(`${providerName}/${modelId}`);
  }

  return (providerName: string, modelId: string) =>
    (gw as any).languageModel(`${providerName}/${modelId}`);
}
