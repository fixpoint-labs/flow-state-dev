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
import type {
  RetryPolicy,
  GatewayConfig,
  GatewayEntry,
  ProviderPreference,
  IntentDefaults,
  ModelGroupDefaults,
} from "./types";
import {
  detectAvailableProviders,
  parseModelString,
  extractProviderName,
  INTENT_NAME_REGEX,
  canonicalizeIntentName,
} from "./providerDetection";
import { createFallbackModel, type FallbackModelEntry } from "./fallbackModel";
import { wrapAiSdkModel } from "./createAiSdkModelResolver";
import { reorderByPreference, normalizePreference } from "./reorderByPreference";
import { warnOnceDev } from "../helpers/deprecation";

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
  /**
   * Optional per-intent defaults. Keys must match a key in `intents`.
   * When a candidate from `intents[name]` wins resolution, the resolver
   * applies `intentDefaults[name]` to the request before the generator's
   * own `providerOptions` overrides it.
   *
   * Construction throws if a key in `intentDefaults` is not also present
   * in `intents`. Applies only on successful candidate resolution — when
   * an intent falls through to `defaultModel`, no intent defaults apply
   * (`defaultModel` has no associated intent context).
   */
  intentDefaults?: Record<string, IntentDefaults>;
  /**
   * Optional env-var source for intent overrides. Defaults to `process.env`.
   * Tests and library callers can pass an explicit object to avoid mutating
   * the global environment.
   *
   * Reads at construction time only — never per-call. See the
   * `Env-var overrides` section in the package README for the variable
   * naming convention.
   */
  env?: Record<string, string | undefined>;
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

/** Env-var name that supplies the API key for each known gateway. */
const GATEWAY_ENV_VARS: Record<string, string> = {
  vercel: "AI_GATEWAY_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
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
// Intent defaults → fallback model defaults
// ---------------------------------------------------------------------------

/**
 * Maps the public {@link IntentDefaults} shape onto the internal
 * {@link ModelGroupDefaults} shape consumed by `createFallbackModel`.
 * Returns `undefined` when there are no defaults to apply, so the fallback
 * model can skip the merge path entirely.
 */
function intentDefaultsToFallbackDefaults(
  intentDefaults: IntentDefaults | undefined
): ModelGroupDefaults | undefined {
  if (!intentDefaults) return undefined;
  const providerOptions = intentDefaults.providerOptions;
  if (!providerOptions || Object.keys(providerOptions).length === 0) {
    return undefined;
  }
  return { providerOptions };
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

  const canonicalToOriginal = new Map<string, string>();
  for (const [name, candidates] of intentEntries) {
    if (!INTENT_NAME_REGEX.test(name)) {
      throw new Error(
        `createModelResolver: invalid intent name "${name}". Must match ${INTENT_NAME_REGEX.source}.`
      );
    }
    const canonical = canonicalizeIntentName(name);
    const existing = canonicalToOriginal.get(canonical);
    if (existing !== undefined && existing !== name) {
      throw new Error(
        `createModelResolver: intent names "${existing}" and "${name}" ` +
          `both map to environment variable FSDEV_INTENT_${canonical}, which is ambiguous. ` +
          `Rename one to avoid collisions for env-var overrides.`
      );
    }
    canonicalToOriginal.set(canonical, name);
    for (const candidate of candidates) {
      const parsed = parseModelString(candidate);
      if (parsed.type === "intent") {
        throw new Error(
          `createModelResolver: intent "${name}" candidate "${candidate}" must not be an intent/* string.`
        );
      }
    }
  }

  if (options.intentDefaults) {
    const intentKeys = new Set(Object.keys(options.intents ?? {}));
    for (const key of Object.keys(options.intentDefaults)) {
      if (!intentKeys.has(key)) {
        throw new Error(
          `createModelResolver: intentDefaults key "${key}" is not a defined intent. ` +
            `Defined intents: ${[...intentKeys].join(", ") || "(none)"}.`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Env-var overrides
// ---------------------------------------------------------------------------

const INTENT_ENV_PREFIX = "FSDEV_INTENT_";
const DEFAULT_MODEL_ENV_VAR = "FSDEV_DEFAULT_MODEL";

interface IntentEnvOverrides {
  /** intent name (as declared in `options.intents`) → override model string */
  intentOverrides: Map<string, string>;
  /** `FSDEV_DEFAULT_MODEL`, if set; replaces `options.defaultModel`. */
  defaultModelOverride: string | undefined;
}

/**
 * Validate a single env-var override value through the existing model-string
 * parser. Throws with a `createModelResolver: <ENV_VAR>: ...` prefix so the
 * operator can see which variable failed.
 */
function validateOverrideValue(value: string | undefined, envKey: string): void {
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `createModelResolver: ${envKey} must be a non-empty string.`
    );
  }
  let parsed;
  try {
    parsed = parseModelString(value);
  } catch (err) {
    const inner = err instanceof Error ? err.message : String(err);
    throw new Error(`createModelResolver: ${envKey}: ${inner}`);
  }
  if (parsed.type === "intent") {
    throw new Error(
      `createModelResolver: ${envKey} must be a 'provider/model' or 'gateway/provider/model' string; received "${value}".`
    );
  }
}

/**
 * Scan the env source for `FSDEV_INTENT_*` and `FSDEV_DEFAULT_MODEL` keys,
 * validate each value, and map them back to declared intent names. Throws if
 * an `FSDEV_INTENT_<NAME>` doesn't match a declared intent, or if
 * `FSDEV_DEFAULT_MODEL` is set with no declared intents.
 *
 * Iterates `env` (not declared intents) so typo'd env-var names surface as
 * loud errors rather than being silently ignored.
 */
function readIntentEnvOverrides(
  env: Record<string, string | undefined>,
  options: CreateModelResolverOptions | undefined
): IntentEnvOverrides {
  const declared = new Map<string, string>();
  for (const name of Object.keys(options?.intents ?? {})) {
    declared.set(canonicalizeIntentName(name), name);
  }

  const result: IntentEnvOverrides = {
    intentOverrides: new Map(),
    defaultModelOverride: undefined,
  };

  for (const [envKey, envValue] of Object.entries(env)) {
    if (envKey === DEFAULT_MODEL_ENV_VAR) {
      if (declared.size === 0) {
        throw new Error(
          `createModelResolver: ${DEFAULT_MODEL_ENV_VAR} was set, but no intents are declared; the override has no effect.`
        );
      }
      validateOverrideValue(envValue, envKey);
      result.defaultModelOverride = (envValue as string).trim();
      continue;
    }

    if (!envKey.startsWith(INTENT_ENV_PREFIX)) continue;

    const canonical = envKey.slice(INTENT_ENV_PREFIX.length);
    const declaredName = declared.get(canonical);
    if (!declaredName) {
      const declaredList = [...declared.values()].join(", ") || "(none)";
      throw new Error(
        `createModelResolver: ${envKey} does not match any declared intent. ` +
          `Declared intents: ${declaredList}.`
      );
    }
    validateOverrideValue(envValue, envKey);
    result.intentOverrides.set(declaredName, (envValue as string).trim());
  }

  return result;
}

/**
 * Produce a shallow-cloned options object with override values folded into
 * `intents` (each overridden intent becomes a one-element candidate list) and
 * `defaultModel` (replaced when `FSDEV_DEFAULT_MODEL` is set). Returns the
 * original reference unchanged when no overrides apply, so the common path
 * allocates nothing.
 */
function applyOverrides(
  options: CreateModelResolverOptions | undefined,
  overrides: IntentEnvOverrides
): CreateModelResolverOptions | undefined {
  if (
    overrides.intentOverrides.size === 0 &&
    overrides.defaultModelOverride === undefined
  ) {
    return options;
  }
  const baseIntents = options?.intents ?? {};
  const nextIntents: Record<string, string[]> = { ...baseIntents };
  for (const [name, value] of overrides.intentOverrides) {
    nextIntents[name] = [value];
  }
  return {
    ...(options ?? {}),
    intents: nextIntents,
    defaultModel:
      overrides.defaultModelOverride ?? options?.defaultModel,
  };
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

  // Apply env-var overrides before any read sites below pick up `options`.
  // The parameter is shadowed by the post-override value so every subsequent
  // read inside this function (including inner closures) sees the overrides.
  const envSource = options?.env ?? process.env;
  const overrides = readIntentEnvOverrides(envSource, options);
  options = applyOverrides(options, overrides);

  for (const [name, value] of overrides.intentOverrides) {
    const envKey = `${INTENT_ENV_PREFIX}${canonicalizeIntentName(name)}`;
    warnOnceDev(
      envKey,
      `Intent "${name}" overridden by ${envKey}; resolves to "${value}".`
    );
  }
  if (overrides.defaultModelOverride !== undefined) {
    warnOnceDev(
      DEFAULT_MODEL_ENV_VAR,
      `defaultModel overridden by ${DEFAULT_MODEL_ENV_VAR}; resolves to "${overrides.defaultModelOverride}".`
    );
  }

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

  // Providers whose direct package load has been attempted and failed
  // (bundled Next.js: key present in env, but `@ai-sdk/openai` not requireable).
  // Cached so we don't reprobe on every call.
  const directLoadFailed = new Set<string>();

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
      if (directLoadFailed.has(providerName)) return undefined;
      try {
        const resolver = loadProviderSync(providerName, info.apiKey!);
        providerCache.set(providerName, resolver);
        return resolver;
      } catch {
        // Direct package not loadable (e.g. bundled Next.js): mark as failed
        // and let the caller try a gateway fallback for the same provider.
        directLoadFailed.add(providerName);
        return undefined;
      }
    }

    return undefined;
  }

  /**
   * Find a gateway that can serve a given provider when the direct path is
   * unavailable. Looks at: (a) the availability map's "gateway" entry for the
   * provider, (b) any configured `options.gateways` (instance, config, or
   * env-backed), and (c) env-detected gateways. Returns the first viable
   * entry; preserves config order. Used purely as fallback when direct
   * resolution can't proceed.
   */
  function findGatewayForProvider(
    providerName: string
  ): { gatewayType: string; apiKey?: string } | undefined {
    const info = availability.get(providerName);
    if (info?.source === "gateway" && info.gatewayType) {
      return { gatewayType: info.gatewayType, apiKey: info.apiKey };
    }

    if (gatewayCache.size > 0) {
      const first = gatewayCache.keys().next().value as string | undefined;
      if (first) return { gatewayType: first };
    }

    if (options?.gateways) {
      for (const [name, entry] of Object.entries(options.gateways)) {
        if (entry == null) continue;
        if (isGatewayConfig(entry)) {
          const envVar = GATEWAY_ENV_VARS[entry.type];
          const apiKey = entry.apiKey ?? (envVar ? process.env[envVar] : undefined);
          if (apiKey) return { gatewayType: entry.type, apiKey };
        } else {
          return { gatewayType: name };
        }
      }
    }

    for (const [gwType, envVar] of Object.entries(GATEWAY_ENV_VARS)) {
      const key = process.env[envVar];
      if (key) return { gatewayType: gwType, apiKey: key };
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
        const gwEntry = options?.gateways?.[gwType];
        const apiKey =
          (isGatewayConfig(gwEntry) ? gwEntry.apiKey : undefined) ??
          process.env[GATEWAY_ENV_VARS[gwType] ?? ""] ??
          undefined;

        if (!apiKey) {
          throw new Error(
            `No API key found for gateway "${gwType}". ` +
              `Set ${GATEWAY_ENV_VARS[gwType] ?? `the ${gwType} gateway API key`} environment variable.`
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
      let directLanguageModel: unknown;
      let directError: unknown;
      if (resolver) {
        try {
          directLanguageModel = resolver(modelId);
        } catch (err) {
          // Factory threw. Don't poison directLoadFailed — that set is for
          // package-load failures caught inside getProviderResolver; this
          // failure is per-invocation. Preserving the original error lets
          // the no-gateway branch below surface it instead of the generic
          // "failed to load" message.
          directError = err;
        }
      }
      if (resolver && directError === undefined) {
        model = wrapAiSdkModel(directLanguageModel, modelString, {
          requested: identityOverrides?.requested ?? modelString,
        });
      } else {
        // Direct path unavailable (no package, or package failed to load in a
        // bundled runtime). Fall through to any configured/auto-detected
        // gateway that can serve this provider — bare `provider/model`
        // resolves "however it can".
        const gw = findGatewayForProvider(providerName);
        if (gw) {
          if (!gatewayCache.has(gw.gatewayType)) {
            if (!gw.apiKey) {
              throw new Error(
                `No API key found for gateway "${gw.gatewayType}" while ` +
                  `falling back from direct "${providerName}".`
              );
            }
            gatewayCache.set(gw.gatewayType, loadGatewaySync(gw.gatewayType, gw.apiKey));
          }
          const languageModel = resolveViaGateway(gw.gatewayType, providerName, modelId);
          model = wrapAiSdkModel(languageModel, modelString, {
            requested: identityOverrides?.requested ?? modelString,
            gateway: gw.gatewayType,
          });
        } else {
          const directFailed = directLoadFailed.has(providerName);
          if (directError && !directFailed) {
            throw directError;
          }
          throw new Error(
            `No provider available for "${providerName}". Tried: ` +
              `${directFailed ? "direct package (failed to load)" : "direct package (not installed)"}` +
              `, gateways (none configured for this provider). ` +
              `Install the provider package, set its API key, or configure a gateway ` +
              `(e.g. AI_GATEWAY_API_KEY).`
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
          defaults: intentDefaultsToFallbackDefaults(
            options?.intentDefaults?.[name]
          ),
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
