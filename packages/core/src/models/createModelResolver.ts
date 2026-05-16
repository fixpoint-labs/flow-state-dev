/**
 * Unified model resolver.
 *
 * Builds a callable that maps model strings (`provider/model`,
 * `gateway/provider/model`, or `intent/<name>`) into resolved
 * {@link GeneratorModel} instances. Handles automatic provider/gateway
 * package loading, availability detection, intent fallback chains, and
 * per-call provider preference overrides.
 */
import { createRequire } from "node:module";
import type { GeneratorModel, ModelResolver, ResolveModelCallOptions } from "../types/model";
import type { RetryPolicy, GatewayConfig, GatewayEntry, ProviderPreference } from "./types";
import {
  detectAvailableProviders,
  parseModelString,
  extractProviderName,
  INTENT_NAME_REGEX,
} from "./providerDetection";
import { createFallbackModel, type FallbackModelEntry } from "./fallbackModel";
import { wrapAiSdkModel } from "./createAiSdkModelResolver";
import { reorderByPreference, normalizePreference } from "./reorderByPreference";
import { warnOnceDev } from "../utils/deprecation";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Options for {@link createModelResolver}. */
export interface CreateModelResolverOptions {
  /** Explicit API keys. Overrides env var detection. */
  keys?: Partial<Record<string, string>>;
  /**
   * Gateway instances or configurations. Keys are gateway names (e.g., "vercel", "openrouter").
   * Pass a pre-created instance for bundled environments (Next.js):
   *   `gateways: { vercel: createGateway({ apiKey }) }`
   * Or a config object for auto-detection:
   *   `gateways: { vercel: { type: "vercel", apiKey: "..." } }`
   */
  gateways?: Record<string, GatewayEntry>;
  /** Retry policy for fallback arrays and intents. */
  retryPolicy?: RetryPolicy;
  /**
   * AI SDK provider instances. Keys are provider prefixes used in model strings.
   * If omitted, auto-creates providers from env vars.
   */
  providers?: Record<string, unknown>;
  /**
   * Default provider preference applied to intent resolution. See
   * {@link ProviderPreference}. Stable-reorders each intent's candidate list by
   * provider bucket before availability filtering — preferred providers first
   * (in the order given), remaining models after in their original order.
   * Omit to preserve the intent author's ordering.
   */
  providerPreference?: ProviderPreference;
  /**
   * Required when {@link CreateModelResolverOptions.intents} is non-empty. The
   * model string returned when an intent has no available candidate, an
   * unknown intent is referenced, or an intent's list is empty. Must be a
   * valid model string (`provider/model` or `gateway/provider/model` — never
   * `intent/*`).
   */
  defaultModel?: string;
  /** Map of intent name → ordered candidate model strings. */
  intents?: Record<string, string[]>;
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

function isGatewayConfig(value: unknown): value is GatewayConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as GatewayConfig).type === "string"
  );
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
// Construction-time validation
// ---------------------------------------------------------------------------

function validateOptions(options: CreateModelResolverOptions | undefined): void {
  if (!options) return;

  if ("presets" in options) {
    throw new Error(
      "createModelResolver: 'presets' option has been removed. Migrate to intents."
    );
  }

  const intents = options.intents;
  const intentEntries = intents ? Object.entries(intents) : [];

  if (intentEntries.length > 0) {
    if (!options.defaultModel) {
      throw new Error(
        "createModelResolver: defaultModel is required when intents are configured"
      );
    }
  }

  if (options.defaultModel !== undefined) {
    const parsed = parseModelString(options.defaultModel);
    if (parsed.type === "intent") {
      throw new Error(
        `createModelResolver: defaultModel must not be an intent/* string (got "${options.defaultModel}").`
      );
    }
  }

  for (const [name, candidates] of intentEntries) {
    if (!INTENT_NAME_REGEX.test(name)) {
      throw new Error(
        `createModelResolver: invalid intent name "${name}". Must match ${INTENT_NAME_REGEX.source}.`
      );
    }
    for (const candidate of candidates) {
      const parsed = parseModelString(candidate);
      if (parsed.type === "intent") {
        throw new Error(
          `createModelResolver: intent "${name}" candidate "${candidate}" must not be an intent/* string.`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a unified model resolver that auto-detects providers from env vars
 * and resolves model strings.
 *
 * Supports:
 * - `"provider/model"` — direct provider access (e.g., `"openai/gpt-5.4"`)
 * - `"gateway/provider/model"` — route through gateway (e.g., `"vercel/openai/gpt-5.4"`)
 * - `"intent/name"` — resolve a configured intent to a fallback model
 *   (e.g., `"intent/chat"`)
 */
export function createModelResolver(
  options?: CreateModelResolverOptions
): ModelResolver {
  validateOptions(options);

  const retryPolicy: Required<RetryPolicy> = {
    ...DEFAULT_RETRY_POLICY,
    ...options?.retryPolicy,
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

  // Seed gateway cache with explicit instances from options.gateways. Config
  // objects (`{ type, apiKey }`) are handled lazily by resolveSingleModel via
  // auto-detection; only raw instances need seeding here.
  if (options?.gateways) {
    for (const [name, entry] of Object.entries(options.gateways)) {
      if (entry == null || isGatewayConfig(entry)) continue;
      gatewayCache.set(name, {
        gateway: entry as Record<string, unknown>,
        type: name,
      });
    }
  }

  // Per-(intent, preferProvider) cache. Without this, every generator call
  // through `intent/<name>` would rebuild the FallbackModel wrapper.
  const intentCache = new Map<string, GeneratorModel>();
  const intentCacheKey = (name: string, pref: ProviderPreference | undefined) =>
    `${name}::${(normalizePreference(pref) ?? []).join("|")}`;

  function getProviderResolver(providerName: string): ProviderResolver | undefined {
    if (explicitProviders?.has(providerName)) {
      return explicitProviders.get(providerName)!;
    }

    if (providerCache.has(providerName)) {
      return providerCache.get(providerName)!;
    }

    const info = availability.get(providerName);
    if (!info) return undefined;

    if (info.source === "key") {
      const resolver = loadProviderSync(providerName, info.apiKey!);
      providerCache.set(providerName, resolver);
      return resolver;
    }

    return undefined;
  }

  function resolveViaGateway(
    gatewayType: string,
    providerName: string,
    modelId: string
  ): unknown {
    const cached = gatewayCache.get(gatewayType);
    if (cached === undefined) {
      throw new Error(`Gateway "${gatewayType}" is not configured.`);
    }
    const { gateway, type } = cached;
    const gatewayModelId = `${providerName}/${modelId}`;

    if (type === "openrouter") {
      return (gateway as any).chat(gatewayModelId);
    }
    return (gateway as any).languageModel(gatewayModelId);
  }

  /**
   * Resolve a single direct or gateway model string (no intents). Throws on
   * unavailable providers / missing packages. Used by both top-level
   * resolution and intent candidate resolution.
   *
   * `identityOverrides` lets intent resolution flow its own `requested`
   * (`intent/<name>`) down to the AI SDK wrapper so emitted items reflect
   * the user-visible intent string, not the winning candidate's framework
   * id. When omitted, the wrapper builds identity from `modelString` alone.
   */
  function resolveSingleModel(
    modelString: string,
    identityOverrides?: { requested?: string }
  ): GeneratorModel {
    // Cache only the no-override case; intent resolution constructs fresh
    // wrappers per intent (cheap) so the override stays accurate.
    if (identityOverrides === undefined) {
      const cached = cache.get(modelString);
      if (cached) return cached;
    }

    const parsed = parseModelString(modelString);

    let model: GeneratorModel;

    if (parsed.type === "intent") {
      throw new Error(
        `resolveSingleModel cannot resolve intent strings; got "${modelString}".`
      );
    } else if (parsed.type === "gateway") {
      const gwType = parsed.gateway!;
      const gwInfo = GATEWAY_PACKAGES[gwType];
      if (!gwInfo) {
        throw new Error(
          `Unknown gateway "${gwType}". Known gateways: ${Object.keys(GATEWAY_PACKAGES).join(", ")}`
        );
      }

      if (!gatewayCache.has(gwType)) {
        const gwEnvVars: Record<string, string> = {
          vercel: "AI_GATEWAY_API_KEY",
          openrouter: "OPENROUTER_API_KEY",
        };
        const gwEntry = options?.gateways?.[gwType];
        const apiKey =
          (isGatewayConfig(gwEntry) ? gwEntry.apiKey : undefined) ??
          process.env[gwEnvVars[gwType] ?? ""] ??
          undefined;

        if (!apiKey) {
          throw new Error(
            `No API key found for gateway "${gwType}". ` +
              `Set ${gwEnvVars[gwType] ?? `the ${gwType} gateway API key`} environment variable.`
          );
        }

        gatewayCache.set(gwType, loadGatewaySync(gwType, apiKey));
      }

      const languageModel = resolveViaGateway(
        gwType,
        parsed.provider!,
        parsed.modelId!
      );
      model = wrapAiSdkModel(languageModel, modelString, {
        requested: identityOverrides?.requested ?? modelString,
        gateway: gwType,
      });
    } else {
      // Direct: provider/model
      const providerName = parsed.provider!;
      const modelId = parsed.modelId!;

      const resolver = getProviderResolver(providerName);
      if (resolver) {
        const languageModel = resolver(modelId);
        model = wrapAiSdkModel(languageModel, modelString, {
          requested: identityOverrides?.requested ?? modelString,
        });
      } else {
        const info = availability.get(providerName);
        if (info?.source === "gateway" && info.gatewayType) {
          if (!gatewayCache.has(info.gatewayType) && info.apiKey) {
            gatewayCache.set(info.gatewayType, loadGatewaySync(info.gatewayType, info.apiKey));
          }
          if (gatewayCache.has(info.gatewayType)) {
            const languageModel = resolveViaGateway(
              info.gatewayType,
              providerName,
              modelId
            );
            model = wrapAiSdkModel(languageModel, modelString, {
              requested: identityOverrides?.requested ?? modelString,
              gateway: info.gatewayType,
            });
          } else {
            throw new Error(
              `No provider available for "${providerName}". ` +
                `Set the appropriate API key or install the provider package.`
            );
          }
        } else {
          throw new Error(
            `No provider available for "${providerName}". ` +
              `Set the appropriate API key or install the provider package.`
          );
        }
      }
    }

    if (identityOverrides === undefined) {
      cache.set(modelString, model);
    }
    return model;
  }

  /** Soft variant: returns null on resolution failure instead of throwing. */
  function tryResolveSingleModel(
    modelString: string,
    identityOverrides?: { requested?: string }
  ): GeneratorModel | null {
    try {
      return resolveSingleModel(modelString, identityOverrides);
    } catch {
      return null;
    }
  }

  function resolveDefaultModel(): GeneratorModel {
    if (!options?.defaultModel) {
      throw new Error(
        `createModelResolver: defaultModel is not configured; cannot fall back from an intent.`
      );
    }
    return resolveSingleModel(options.defaultModel);
  }

  function resolveIntent(
    name: string,
    callOptions?: ResolveModelCallOptions
  ): GeneratorModel {
    const effectivePreference =
      callOptions?.preferProvider ?? options?.providerPreference;
    const cacheKey = intentCacheKey(name, effectivePreference);
    const cached = intentCache.get(cacheKey);
    if (cached) return cached;

    const candidates = options?.intents?.[name];
    if (!candidates || candidates.length === 0) {
      warnOnceDev(
        `intent/${name}`,
        `Unknown or empty intent "${name}"; falling back to defaultModel.`
      );
      const fallback = resolveDefaultModel();
      intentCache.set(cacheKey, fallback);
      return fallback;
    }

    const intentRequested = `intent/${name}`;
    const tagged = candidates.map((s) => ({
      modelString: s,
      providerName: extractProviderName(s),
    }));
    const reordered = reorderByPreference(tagged, effectivePreference);

    const resolved: FallbackModelEntry[] = [];
    for (const entry of reordered) {
      // Pass the intent string as the `requested` identity so emitted items
      // report the user-visible intent name (e.g. `intent/chat`) rather than
      // the winning candidate's framework id.
      const model = tryResolveSingleModel(entry.modelString, {
        requested: intentRequested,
      });
      if (model) {
        resolved.push({
          modelId: entry.modelString,
          providerName: entry.providerName,
          model,
        });
      }
    }

    const result = resolved.length === 0
      ? resolveDefaultModel()
      : createFallbackModel({
          groupName: `intent/${name}`,
          models: resolved,
          retryPolicy,
        });
    intentCache.set(cacheKey, result);
    return result;
  }

  const resolver = ((
    modelId: string,
    _blockName?: string,
    callOptions?: ResolveModelCallOptions
  ): GeneratorModel => {
    const parsed = parseModelString(modelId);
    if (parsed.type === "intent") {
      return resolveIntent(parsed.intentName!, callOptions);
    }
    return resolveSingleModel(modelId);
  }) as ModelResolver;

  resolver.resolveId = (
    modelId: string,
    callOptions?: { preferProvider?: ProviderPreference }
  ): string => {
    const parsed = parseModelString(modelId);
    if (parsed.type !== "intent") return modelId;

    const candidates = options?.intents?.[parsed.intentName!];
    if (!candidates || candidates.length === 0) {
      return options?.defaultModel ?? modelId;
    }

    const preference =
      callOptions?.preferProvider !== undefined
        ? callOptions.preferProvider
        : options?.providerPreference;

    const tagged = candidates.map((modelString) => ({
      modelString,
      providerName: extractProviderName(modelString),
    }));
    const ordered = reorderByPreference(tagged, preference);

    for (const t of ordered) {
      try {
        resolveSingleModel(t.modelString);
        return t.modelString;
      } catch {
        // try next
      }
    }
    return options?.defaultModel ?? modelId;
  };

  return resolver;
}
