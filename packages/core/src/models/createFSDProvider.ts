import { createRequire } from "node:module";
import type { GeneratorModel } from "../types/model";
import type {
  FSDProviderConfig,
  FSDProvider,
  ModelGroupConfig,
  RetryPolicy,
  ResolveOptions,
  ExplainResult,
  ExplainCandidate,
} from "./types";
import type { ProviderAvailability } from "./providerDetection";
import {
  detectAvailableProviders,
  parseModelString,
} from "./providerDetection";
import { createFallbackModel } from "./fallbackModel";
import { wrapAiSdkModel } from "./createAiSdkModelResolver";
import {
  hasPreferredProvider,
  normalizePreference,
  reorderByPreference,
} from "./reorderByPreference";

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

/** Internal shape used for reorder + resolution, distinct from public types. */
interface ResolvedCandidate {
  modelId: string;
  providerName: string;
  /** Available means we can construct a working GeneratorModel. */
  available: boolean;
  source?: "key" | "gateway";
  gateway?: string;
  reason?: string;
  /** Populated only when `available === true`. */
  model?: GeneratorModel;
}

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
 * // brand preference — orthogonal to the group tier:
 * const gen2 = generator({ model: provider('fast', { preferProvider: 'anthropic' }) });
 * ```
 */
const LEGACY_PREFER_MIGRATION_MESSAGE =
  "createFSDProvider: the `prefer` option has been renamed to `preferProvider`. See FIX-512 for context.";

function rejectLegacyPrefer(options: ResolveOptions | undefined): void {
  if (options && "prefer" in options) {
    throw new Error(LEGACY_PREFER_MIGRATION_MESSAGE);
  }
}

export function createFSDProvider(config: FSDProviderConfig): FSDProvider {
  const retryPolicy: Required<RetryPolicy> = {
    ...DEFAULT_RETRY_POLICY,
    ...config.retryPolicy,
  };

  const availability = detectAvailableProviders({
    keys: config.keys,
    gateways: config.gateways,
  });

  const aiSdkProviders = resolveAiSdkProviders(config.providers, availability);

  // Cache keyed by (groupName + serialized resolve options). Calls with the
  // same preference reuse the same fallback model.
  const groupCache = new Map<string, GeneratorModel>();

  function effectivePreference(options: ResolveOptions | undefined): string[] {
    // Call-site overrides provider-level default (FIX-425 precedence).
    const raw =
      options?.preferProvider !== undefined
        ? options.preferProvider
        : config.providerPreference;
    return normalizePreference(raw) ?? [];
  }

  function cacheKey(groupName: string, options: ResolveOptions | undefined): string {
    const preferProvider = effectivePreference(options);
    const strict = options?.strict === true;
    return `${groupName}::${preferProvider.join("|")}::${strict ? "s" : ""}`;
  }

  /**
   * Build the candidate list for a group, tagged with availability. Pure
   * enough to feed both `resolveGroup` and `explain`; does not throw for
   * unknown groups (caller decides).
   */
  function buildCandidates(groupName: string): {
    group: ModelGroupConfig;
    candidates: ResolvedCandidate[];
  } | null {
    const group = config.groups[groupName];
    if (!group) return null;

    const candidates: ResolvedCandidate[] = group.models.map((modelString) => {
      const parsed = parseModelString(modelString);
      const providerName = parsed.provider ?? "unknown";
      const modelId = parsed.modelId;
      const resolver = aiSdkProviders.get(providerName);
      const availabilityInfo = availability.get(providerName);

      if (!resolver || !modelId) {
        return {
          modelId: modelString,
          providerName,
          available: false,
          reason: resolver
            ? "invalid-model-string"
            : availabilityInfo
              ? "provider-package-missing"
              : "no-key-no-gateway",
        };
      }

      try {
        const languageModel = resolver(providerName, modelId);
        return {
          modelId: modelString,
          providerName,
          available: true,
          source: availabilityInfo?.source,
          gateway:
            availabilityInfo?.source === "gateway"
              ? availabilityInfo.gatewayName ?? availabilityInfo.gatewayType
              : undefined,
          model: wrapAiSdkModel(languageModel, modelString),
        };
      } catch {
        return {
          modelId: modelString,
          providerName,
          available: false,
          reason: "provider-load-failed",
        };
      }
    });

    return { group, candidates };
  }

  function resolveGroup(
    groupName: string,
    options?: ResolveOptions
  ): GeneratorModel {
    rejectLegacyPrefer(options);
    const key = cacheKey(groupName, options);
    const cached = groupCache.get(key);
    if (cached) return cached;

    const built = buildCandidates(groupName);
    if (!built) {
      const avail = Object.keys(config.groups).join(", ");
      throw new Error(
        `Unknown model group "${groupName}". Available groups: ${avail}`
      );
    }

    const prefer = effectivePreference(options);
    const strict = options?.strict === true;

    if (strict && prefer.length > 0) {
      if (!hasPreferredProvider(built.candidates, prefer)) {
        throw new Error(
          `Preset "${groupName}" contains no models from preferred provider(s) [${prefer.join(
            ", "
          )}]. Add a model from one of those providers to the preset or disable strict mode.`
        );
      }
    }

    // Reorder (stable) by preference, then filter to only available models.
    const reordered = reorderByPreference(built.candidates, prefer);
    const availableEntries = reordered.filter((c) => c.available);

    if (strict && prefer.length > 0) {
      const anyPreferredAvailable = availableEntries.some((c) =>
        prefer.includes(c.providerName)
      );
      if (!anyPreferredAvailable) {
        throw new Error(
          `Preset "${groupName}" has no available models from preferred provider(s) [${prefer.join(
            ", "
          )}]. Configure an API key or gateway for one of those providers, or disable strict mode.`
        );
      }
    }

    const fallbackModel = createFallbackModel({
      groupName,
      models: availableEntries.map((c) => ({
        modelId: c.modelId,
        providerName: c.providerName,
        model: c.model!,
      })),
      defaults: built.group.defaults,
      retryPolicy,
    });

    groupCache.set(key, fallbackModel);
    return fallbackModel;
  }

  const provider = function (
    groupName: string,
    options?: ResolveOptions
  ): GeneratorModel {
    rejectLegacyPrefer(options);
    return resolveGroup(groupName, options);
  } as FSDProvider;

  provider.languageModel = resolveGroup;

  provider.groups = () => Object.keys(config.groups);

  provider.available = (groupName: string, options?: ResolveOptions) => {
    rejectLegacyPrefer(options);
    const built = buildCandidates(groupName);
    if (!built) return [];
    const preferProvider = effectivePreference(options);
    return reorderByPreference(built.candidates, preferProvider)
      .filter((c) => c.available)
      .map((c) => c.modelId);
  };

  provider.explain = (groupName: string, options?: ResolveOptions): ExplainResult => {
    rejectLegacyPrefer(options);
    const built = buildCandidates(groupName);
    if (!built) {
      return { preset: groupName, prefer: [], candidates: [], willUse: null };
    }
    const preferProvider = effectivePreference(options);
    const reordered = reorderByPreference(built.candidates, preferProvider);
    const firstAvailable = reordered.find((c) => c.available);
    const candidates: ExplainCandidate[] = reordered.map((c) => {
      const row: ExplainCandidate = {
        modelId: c.modelId,
        providerName: c.providerName,
        available: c.available,
      };
      if (c.available) {
        if (c.source) row.source = c.source;
        if (c.gateway) row.gateway = c.gateway;
      } else if (c.reason) {
        row.reason = c.reason;
      }
      return row;
    });
    return {
      preset: groupName,
      prefer: preferProvider,
      candidates,
      willUse: firstAvailable?.modelId ?? null,
    };
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
