/**
 * Unified model resolver.
 *
 * Builds a callable that maps model strings (`provider/model`,
 * `name:model`, or `intent/<name>`) into resolved
 * {@link GeneratorModel} instances. Handles automatic provider/gateway
 * package loading, availability detection, intent fallback chains, and
 * per-call provider preference overrides. Also resolves model strings to
 * evaluation models for `evaluator` blocks (`resolveEvaluationModel`).
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { GeneratorModel, ModelResolver, ResolveModelCallOptions } from "../types/model";
import type { EvaluationModel } from "../types/evaluation";
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
  INTENT_NAME_REGEX,
  canonicalizeIntentName,
  GATEWAY_ENV_VARS,
  PROVIDER_ENV_VARS,
  type ParsedModelString,
} from "./providerDetection";
import { createFallbackModel, type FallbackModelEntry } from "./fallbackModel";
import { wrapAiSdkModel } from "./createAiSdkModelResolver";
import { markEvaluationModelGateway } from "./evaluationModelGateway";
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
   * Gateway instances or configurations. Keys are gateway names (e.g., "vercel", "openrouter"),
   * and each key is a route name for `name:model` strings (`"vercel:openai/gpt-6.1-sol"`).
   * A key may not also be a key of `providers`.
   * Pass a pre-created instance for bundled environments (Next.js):
   *   `gateways: { vercel: createGateway({ apiKey }) }`
   * Or a config object for auto-detection:
   *   `gateways: { vercel: { type: "vercel", apiKey: "..." } }`
   */
  gateways?: Record<string, GatewayEntry>;
  /** Retry policy for fallback arrays and intents. */
  retryPolicy?: RetryPolicy;
  /**
   * AI SDK provider instances. Keys are provider prefixes used in model strings,
   * both `name/model` and the pinned `name:model` (`"triage:native"`).
   * A key may not also be a key of `gateways`, nor `vercel` or `openrouter`.
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
   * valid model string (`provider/model` or `name:model` — never
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

/** The npm package and named factory export backing one provider or gateway. */
type PackageInfo = { pkg: string; factory: string };

const PROVIDER_PACKAGES: Record<string, PackageInfo> = {
  anthropic: { pkg: "@ai-sdk/anthropic", factory: "createAnthropic" },
  openai: { pkg: "@ai-sdk/openai", factory: "createOpenAI" },
  google: { pkg: "@ai-sdk/google", factory: "createGoogle" },
};

const GATEWAY_PACKAGES: Record<string, PackageInfo> = {
  vercel: { pkg: "@ai-sdk/gateway", factory: "createGateway" },
  openrouter: { pkg: "@openrouter/ai-sdk-provider", factory: "createOpenRouter" },
};

/**
 * Providers whose model strings an evaluator always resolves through a
 * gateway, never through a provider registered under `providers` or an
 * installed package. `typesafe-ai/jev` names the gateway's Jev; direct Jev
 * is an evaluation model instance the author builds (spec D2).
 */
const GATEWAY_ONLY_EVALUATION_PROVIDERS: ReadonlySet<string> = new Set(["typesafe-ai"]);

const _require = createRequire(import.meta.url);
const _cwdRequire = createRequire(new URL(`file://${process.cwd()}/`));

// Bundlers (Next.js/Turbopack, webpack) statically analyze the syntactic form
// `require.resolve(x)` and warn "Module not found: Can't resolve (...)" for
// every optional provider package — including ones the app never installed —
// on every compile. These resolves are runtime-only, against the app's
// node_modules, and must never be bundled. Turbopack does NOT honor a
// `turbopackIgnore` comment on `require.resolve` (only on `import()`), so we
// call `.resolve` through a bound reference: the indirection breaks the
// bundler's syntactic match while preserving identical runtime behavior.
const _resolve = _require.resolve.bind(_require);
const _cwdResolve = _cwdRequire.resolve.bind(_cwdRequire);

/**
 * Resolve a package specifier to an absolute file path WITHOUT executing the
 * module. AI SDK 7 packages are ESM-only, so execution needs dynamic
 * `import()` (async) — but availability decisions (intent candidate
 * filtering, direct→gateway fall-through, `resolveId`) must stay
 * synchronous. CJS resolution still finds ESM-only packages (their exports
 * maps carry a `default` condition); only execution would fail.
 *
 * Falls back to resolving from `process.cwd()` (app root) for pnpm strict
 * isolation, where the app installs the provider package but this package
 * cannot see it from its own location.
 */
function tryResolveModulePath(packageName: string): string | undefined {
  try {
    return _resolve(packageName);
  } catch {
    try {
      return _cwdResolve(packageName);
    } catch {
      return undefined;
    }
  }
}

function isModuleResolvable(packageName: string): boolean {
  return tryResolveModulePath(packageName) !== undefined;
}

// Single-flight module execution cache. Failed imports stay cached: a broken
// install does not repair itself mid-process, and re-probing on every call
// would repeat the failure.
const moduleExecutionCache = new Map<string, Promise<Record<string, unknown>>>();

/** Execute a provider/gateway package via dynamic `import()` (ESM-safe). */
function importModule(packageName: string): Promise<Record<string, unknown>> {
  let pending = moduleExecutionCache.get(packageName);
  if (pending === undefined) {
    pending = (async () => {
      const resolvedPath = tryResolveModulePath(packageName);
      if (resolvedPath === undefined) {
        throw new Error(`Package "${packageName}" is not installed.`);
      }
      // webpackIgnore/turbopackIgnore: the specifier is a runtime-computed
      // file:// URL; leave it to Node's native import at runtime instead of
      // the bundler (which would emit a "Can't resolve <dynamic>" warning).
      return (await import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(resolvedPath).href
      )) as Record<string, unknown>;
    })();
    moduleExecutionCache.set(packageName, pending);
  }
  return pending;
}

/**
 * Wrap a provider/gateway package load failure with a stable marker
 * (`name: "ProviderLoadError"`). The lazy `GeneratorModel` split means a
 * resolvable-but-broken install surfaces at first generate/stream instead of
 * at resolve time (where v6 filtered it), so `fallbackModel`'s loops
 * recognize this name and skip to the next candidate. Name-based rather than
 * `instanceof` to stay realm/module safe, matching the existing duck-typed
 * error checks in `isRetryableError`.
 */
function providerLoadError(message: string, cause?: unknown): Error {
  const error =
    cause === undefined
      ? new Error(message)
      : new Error(message, {
          cause: cause instanceof Error ? cause : new Error(String(cause)),
        });
  error.name = "ProviderLoadError";
  return error;
}

/** Look up a named factory export, tolerating CJS default-namespace interop. */
function resolveFactoryExport(
  mod: Record<string, unknown>,
  factoryName: string
): ((opts: { apiKey: string }) => unknown) | undefined {
  const direct = mod[factoryName];
  if (typeof direct === "function") {
    return direct as (opts: { apiKey: string }) => unknown;
  }
  const viaDefault = (mod.default as Record<string, unknown> | undefined)?.[factoryName];
  return typeof viaDefault === "function"
    ? (viaDefault as (opts: { apiKey: string }) => unknown)
    : undefined;
}

// ---------------------------------------------------------------------------
// Internal provider loading
// ---------------------------------------------------------------------------

type PackageKind = "provider" | "gateway";

/**
 * Execute a provider or gateway package and instantiate its factory.
 * Async because AI SDK 7 packages are ESM-only. Callers already gate on
 * the package map and the synchronous availability check, so failures
 * here mean a resolvable-but-broken install — surfaced with the
 * actionable package name, never an opaque ESM resolution error.
 */
async function instantiateFactory<T>(
  kind: PackageKind,
  name: string,
  info: PackageInfo,
  apiKey: string
): Promise<T> {
  let mod: Record<string, unknown>;
  try {
    mod = await importModule(info.pkg);
  } catch (err) {
    throw providerLoadError(
      kind === "provider"
        ? `Provider package "${info.pkg}" failed to load. ` +
          `Install it to use ${name} models directly.`
        : `Gateway package "${info.pkg}" failed to load. ` +
          `Install it to use the ${name} gateway.`,
      err
    );
  }

  const factory = resolveFactoryExport(mod, info.factory);
  if (factory === undefined) {
    // Wrong-major installs (resolvable, importable, missing the expected
    // factory) are load failures too — same marker so fallback loops skip
    // the candidate instead of aborting streaming intents.
    throw providerLoadError(
      `${kind === "provider" ? "Provider" : "Gateway"} package "${info.pkg}" ` +
        `does not export "${info.factory}". ` +
        `The installed version may be incompatible with this framework.`
    );
  }
  // The factory comes from a dynamic import, so its shape cannot be checked
  // statically. The one assertion lives here; call sites name the type they
  // expect instead of re-casting the returned promise.
  return factory({ apiKey }) as T;
}

/**
 * Wraps an async model constructor behind the synchronous
 * {@link GeneratorModel} surface. Package execution (dynamic `import()`)
 * happens on the first `generate`/`stream` call and is cached single-flight;
 * resolution-time code paths stay fully synchronous, preserving the public
 * `ModelResolver` contract on ESM-only AI SDK 7 packages.
 *
 * `resolveSearchTool` returns undefined by design: package-loaded models
 * never carried a provider `.tools` namespace through `wrapAiSdkModel`
 * before this split either, so provider search tools remain unavailable on
 * this path (parity).
 */
function createLazyGeneratorModel(
  modelId: string,
  loadModel: () => Promise<GeneratorModel>
): GeneratorModel {
  let pending: Promise<GeneratorModel> | undefined;
  const load = () => (pending ??= loadModel());
  return {
    modelId,
    async generate(options) {
      return (await load()).generate(options);
    },
    async *stream(options) {
      const inner = await load();
      yield* inner.stream!(options);
    },
    // The loaded model is always `wrapAiSdkModel`'s, which carries the
    // single-step methods. Declared here, before the load, because a
    // generator decides by their presence whether it owns the tool loop — and
    // only the owned loop lets a tool's `ctx.suspend()` pause the run.
    async generateStep(options) {
      return (await load()).generateStep!(options);
    },
    async *streamStep(options) {
      const inner = await load();
      yield* inner.streamStep!(options);
    },
    resolveSearchTool: () => undefined,
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
// Route classification (the colon lane)
// ---------------------------------------------------------------------------

/** A colon string, classified. Gateway before provider; {@link validateRouteNames} keeps a name out of both maps. */
type Route =
  | { kind: "gateway"; name: string; modelId: string }
  | { kind: "provider"; name: string; modelId: string };

/**
 * Whether `name` is an own key of `map`. A route name comes from a caller's
 * string, so a name every object inherits (`constructor`, `toString`) must
 * never read as registered.
 */
function hasRoute(map: object | undefined, name: string): boolean {
  return map != null && Object.hasOwn(map, name);
}

/** The one route classifier: every path that branches on a colon string goes through it. */
function classifyRoute(
  parsed: Extract<ParsedModelString, { type: "alias" }>,
  modelString: string,
  options: Pick<CreateModelResolverOptions, "providers" | "gateways"> | undefined
): Route {
  const name = parsed.alias;
  const modelId = parsed.modelId;
  if ((hasRoute(options?.gateways, name) && options!.gateways![name] != null) || hasRoute(GATEWAY_PACKAGES, name)) {
    return { kind: "gateway", name, modelId };
  }
  if ((hasRoute(options?.providers, name) && options!.providers![name] !== undefined) || hasRoute(PROVIDER_PACKAGES, name)) {
    return { kind: "provider", name, modelId };
  }
  const registered = [
    ...Object.keys(options?.providers ?? {}).map((k) => `${k} (providers)`),
    ...Object.keys(options?.gateways ?? {}).map((k) => `${k} (gateways)`),
  ];
  throw new Error(
    `Unknown route "${name}" in "${modelString}". The name before ":" must be a key of ` +
      `providers or gateways, or a built-in one (providers: ${Object.keys(PROVIDER_PACKAGES).join(", ")}; ` +
      `gateways: ${Object.keys(GATEWAY_PACKAGES).join(", ")}). ` +
      `Registered: ${registered.join(", ") || "(none)"}.`
  );
}

/** One name, one map: a colon no longer keeps a gateway and a provider apart by slash count. */
function validateRouteNames(options: CreateModelResolverOptions | undefined): void {
  const providerKeys = Object.keys(options?.providers ?? {});
  const gatewayKeys = new Set(Object.keys(options?.gateways ?? {}));
  for (const name of providerKeys) {
    if (gatewayKeys.has(name)) {
      throw new Error(
        `createModelResolver: "${name}" is a key of both providers and gateways, so "${name}:<model>" ` +
          `would name two routes. Rename one of them.`
      );
    }
    if (hasRoute(GATEWAY_PACKAGES, name)) {
      throw new Error(
        `createModelResolver: "${name}" is a providers key and the name of the built-in ${name} gateway, ` +
          `so "${name}:<model>" would name two routes. Rename the provider, or pass the instance under gateways.`
      );
    }
  }
}

/** Parse a config string and, when it names a route, classify it, so a bad one fails at startup. */
function parseConfigModelString(
  modelString: string,
  options: CreateModelResolverOptions | undefined
): ParsedModelString {
  const parsed = parseModelString(modelString);
  if (parsed.type === "alias") classifyRoute(parsed, modelString, options);
  return parsed;
}

// ---------------------------------------------------------------------------
// Construction-time validation
// ---------------------------------------------------------------------------

function validateOptions(options: CreateModelResolverOptions | undefined): void {
  if (!options) return;

  validateRouteNames(options);

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
    const parsed = parseConfigModelString(options.defaultModel, options);
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
      const parsed = parseConfigModelString(candidate, options);
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
function validateOverrideValue(
  value: string | undefined,
  envKey: string,
  options: CreateModelResolverOptions | undefined
): void {
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `createModelResolver: ${envKey} must be a non-empty string.`
    );
  }
  let parsed;
  try {
    parsed = parseConfigModelString(value, options);
  } catch (err) {
    const inner = err instanceof Error ? err.message : String(err);
    throw new Error(`createModelResolver: ${envKey}: ${inner}`);
  }
  if (parsed.type === "intent") {
    throw new Error(
      `createModelResolver: ${envKey} must be a 'provider/model' or 'name:model' string; received "${value}".`
    );
  }
}

/**
 * Scan the env source for `FSDEV_INTENT_*` and `FSDEV_DEFAULT_MODEL` keys,
 * validate each value, and map them back to declared intent names. An
 * `FSDEV_INTENT_<NAME>` that doesn't match a declared intent is warned-and-
 * skipped (env is ambient — an app must not crash because its environment names
 * an intent it doesn't declare). `FSDEV_DEFAULT_MODEL` replaces `defaultModel`
 * whether or not intents are declared — a host that resolves no model just
 * never reads it, so an ambient value must not crash it.
 *
 * Iterates `env` (not declared intents) so a typo in an intent the app DOES use
 * surfaces as a warning rather than being silently ignored.
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
      validateOverrideValue(envValue, envKey, options);
      result.defaultModelOverride = (envValue as string).trim();
      continue;
    }

    if (!envKey.startsWith(INTENT_ENV_PREFIX)) continue;

    const canonical = envKey.slice(INTENT_ENV_PREFIX.length);
    const declaredName = declared.get(canonical);
    if (!declaredName) {
      // Env vars are ambient — a shared/automation environment may pin
      // `FSDEV_INTENT_*` for intents OTHER apps declare. An app must not crash
      // because the environment names an intent it doesn't declare, so the
      // stray override is warned-and-skipped, not fatal. (A typo in an intent
      // the app DOES use still surfaces here as a warning.)
      const declaredList = [...declared.values()].join(", ") || "(none)";
      warnOnceDev(
        envKey,
        `${envKey} does not match any declared intent ` +
          `(declared: ${declaredList}); ignoring the override.`
      );
      continue;
    }
    validateOverrideValue(envValue, envKey, options);
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
 * - `"provider/model"` — the provider directly, else a configured gateway
 *   (e.g., `"openai/gpt-6.1-sol"`)
 * - `"name:model"` — a named route, pinned: a gateway (`"vercel:openai/gpt-6.1-sol"`)
 *   or a provider (`"openai:gpt-6.1-sol"`, `"triage:native"`). Never falls through.
 * - `"intent/name"` — resolve a configured intent to a fallback model
 *   (e.g., `"intent/chat"`)
 *
 * The removed `gateway/provider/model` form throws, naming its colon spelling:
 * at construction for config strings, on first resolve for any other.
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

  // Single-flight cache for lazily executed provider packages (by provider
  // name). Values are promises: package execution is async (ESM-only) and
  // happens on first generate/stream, not at resolve time.
  const providerLoadCache = new Map<string, Promise<ProviderResolver>>();

  // Providers whose direct package cannot be resolved on disk
  // (bundled Next.js: key present in env, but `@ai-sdk/openai` not
  // resolvable). Cached so we don't reprobe on every call.
  const directLoadFailed = new Set<string>();

  // Cache for gateway instances (explicit instances from options.gateways,
  // plus lazily loaded package-backed gateways once their import completes).
  const gatewayCache = new Map<string, { gateway: Record<string, unknown>; type: string }>();

  // Single-flight cache for lazily executed gateway packages (by type).
  const gatewayLoadCache = new Map<string, Promise<{ gateway: Record<string, unknown>; type: string }>>();

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

  /**
   * Sync availability check for the auto-loaded (package) direct-provider
   * path. True when the provider has an API key and its package resolves on
   * disk. Module resolution (not execution) keeps this synchronous — the
   * three sync decision points depend on it: the intent candidate filter,
   * the direct→gateway fall-through (FIX-609), and public `resolveId`.
   * Explicit provider instances are handled separately by the caller.
   */
  function isPackageProviderAvailable(providerName: string): boolean {
    const info = availability.get(providerName);
    if (!info || info.source !== "key") return false;
    if (directLoadFailed.has(providerName)) return false;

    const pkg = PROVIDER_PACKAGES[providerName]?.pkg;
    if (pkg === undefined || !isModuleResolvable(pkg)) {
      // Direct package not resolvable (e.g. bundled Next.js): mark as failed
      // and let the caller try a gateway fallback for the same provider.
      directLoadFailed.add(providerName);
      return false;
    }
    return true;
  }

  /** Single-flight lazy execution of an available provider package. */
  function loadPackageProvider(providerName: string): Promise<ProviderResolver> {
    let pending = providerLoadCache.get(providerName);
    if (pending === undefined) {
      const info = availability.get(providerName)!;
      pending = instantiateFactory<ProviderResolver>(
        "provider",
        providerName,
        PROVIDER_PACKAGES[providerName]!,
        info.apiKey!
      );
      providerLoadCache.set(providerName, pending);
    }
    return pending;
  }

  /**
   * Sync guard for a package-backed gateway: same actionable "not installed"
   * error the eager loader used to throw at resolve time, kept synchronous so
   * intent filtering and `resolveId` drop gateway candidates correctly.
   */
  function ensureGatewayPackageAvailable(gatewayType: string): void {
    const info = GATEWAY_PACKAGES[gatewayType];
    if (!info) {
      throw new Error(`Unknown gateway type: "${gatewayType}"`);
    }
    if (!isModuleResolvable(info.pkg)) {
      throw new Error(
        `Gateway package "${info.pkg}" is not installed. ` +
          `Install it to use the ${gatewayType} gateway.`
      );
    }
  }

  /**
   * Single-flight lazy execution of a gateway package, cached under the name
   * the gateway is registered by (`cacheKey`). Two gateways of one type with
   * different keys are two accounts, so `type` only picks the package.
   */
  function loadGateway(
    cacheKey: string,
    gatewayType: string,
    apiKey: string
  ): Promise<{ gateway: Record<string, unknown>; type: string }> {
    let pending = gatewayLoadCache.get(cacheKey);
    if (pending === undefined) {
      pending = instantiateFactory<Record<string, unknown>>(
        "gateway",
        gatewayType,
        GATEWAY_PACKAGES[gatewayType]!,
        apiKey
      ).then((gateway) => {
        const entry = { gateway, type: gatewayType };
        // Populate the sync cache so later fall-through decisions
        // (findGatewayForProvider) see the loaded gateway, matching the
        // pre-migration behavior where loading happened at resolve time.
        gatewayCache.set(cacheKey, entry);
        return entry;
      });
      gatewayLoadCache.set(cacheKey, pending);
    }
    return pending;
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
  ): { cacheKey: string; gatewayType: string; apiKey?: string } | undefined {
    const info = availability.get(providerName);
    if (info?.source === "gateway" && info.gatewayType) {
      // A configured gateway is cached under its registered name; one
      // detected from the environment, under its type.
      const name = info.gatewayName;
      const cacheKey = name === undefined || name.startsWith("auto-") ? info.gatewayType : name;
      return { cacheKey, gatewayType: info.gatewayType, apiKey: info.apiKey };
    }

    if (options?.gateways) {
      for (const [name, entry] of Object.entries(options.gateways)) {
        if (entry == null) continue;
        if (isGatewayConfig(entry)) {
          const envVar = GATEWAY_ENV_VARS[entry.type];
          const apiKey = entry.apiKey ?? (envVar ? process.env[envVar] : undefined);
          if (apiKey) return { cacheKey: name, gatewayType: entry.type, apiKey };
        } else {
          return { cacheKey: name, gatewayType: name };
        }
      }
    }

    for (const [gwType, envVar] of Object.entries(GATEWAY_ENV_VARS)) {
      const key = process.env[envVar];
      if (key) return { cacheKey: gwType, gatewayType: gwType, apiKey: key };
    }

    return undefined;
  }

  /** A gateway's language model for its own id (`openai/gpt-6.1-sol`, `typesafe-ai/jev`). */
  function gatewayLanguageModel(
    entry: { gateway: Record<string, unknown>; type: string },
    gatewayModelId: string
  ): unknown {
    const { gateway, type } = entry;

    if (type === "openrouter") {
      return (gateway as any).chat(gatewayModelId);
    }
    return (gateway as any).languageModel(gatewayModelId);
  }

  /**
   * Resolve a gateway-served model: eager wrap when the gateway instance is
   * already cached (explicit instance or previously loaded package),
   * otherwise a lazily loaded package-backed model. `missingKeyMessage`
   * keeps each call site's distinct missing-API-key error.
   */
  function resolveGatewayModel(
    cacheKey: string,
    gwType: string,
    apiKey: string | undefined,
    gatewayModelId: string,
    modelString: string,
    identity: { requested: string; gateway: string },
    missingKeyMessage: string
  ): GeneratorModel {
    const cachedGateway = gatewayCache.get(cacheKey);
    if (cachedGateway !== undefined) {
      return wrapAiSdkModel(
        gatewayLanguageModel(cachedGateway, gatewayModelId),
        modelString,
        identity
      );
    }

    if (!apiKey) {
      throw new Error(missingKeyMessage);
    }

    ensureGatewayPackageAvailable(gwType);
    return createLazyGeneratorModel(modelString, async () => {
      const entry = await loadGateway(cacheKey, gwType, apiKey);
      return wrapAiSdkModel(
        gatewayLanguageModel(entry, gatewayModelId),
        modelString,
        identity
      );
    });
  }

  /** The cache key, gateway type and key behind a gateway route name. */
  function namedGateway(name: string): { cacheKey: string; gwType: string; apiKey: string | undefined } {
    const entry = hasRoute(options?.gateways, name) ? options!.gateways![name] : undefined;
    if (entry != null && !isGatewayConfig(entry)) return { cacheKey: name, gwType: name, apiKey: undefined };
    const gwType = isGatewayConfig(entry) ? entry.type : name;
    const apiKey =
      (isGatewayConfig(entry) ? entry.apiKey : undefined) ??
      process.env[GATEWAY_ENV_VARS[gwType] ?? ""] ??
      undefined;
    return { cacheKey: name, gwType, apiKey };
  }

  function pinnedProviderError(name: string, modelId: string, modelString: string): Error {
    const envVar = hasRoute(PROVIDER_ENV_VARS, name) ? PROVIDER_ENV_VARS[name] : undefined;
    const keyed = availability.get(name)?.source === "key";
    const missing =
      envVar === undefined
        ? "it is not usable as a language-model provider"
        : keyed
          ? `its package "${PROVIDER_PACKAGES[name]!.pkg}" is not installed`
          : `no API key is set (${envVar})`;
    return new Error(
      `"${modelString}" names the ${name} provider, but ${missing}. ` +
        `A "name:model" string does not fall back to a gateway; write "${name}/${modelId}" to allow one.`
    );
  }

  function resolvePinnedProvider(
    name: string,
    modelId: string,
    modelString: string,
    identity: { requested: string }
  ): GeneratorModel {
    const explicit = explicitProviders?.get(name);
    if (explicit !== undefined) {
      return wrapAiSdkModel(explicit(modelId), modelString, identity);
    }
    if (!(hasRoute(options?.providers, name) && options!.providers![name] !== undefined) && isPackageProviderAvailable(name)) {
      return createLazyGeneratorModel(modelString, async () => {
        const providerResolver = await loadPackageProvider(name);
        return wrapAiSdkModel(providerResolver(modelId), modelString, identity);
      });
    }
    throw pinnedProviderError(name, modelId, modelString);
  }

  /**
   * A best-effort label: the provider a model string's call reaches, read
   * from this resolver's maps. It never throws; where resolving the string
   * would throw, it returns `"unknown"`. `anthropic` for `vercel:anthropic/…`,
   * `triage` for `triage:native`, `openai` for `openai/gpt-6.1-sol`; `"unknown"`
   * for an intent or a gateway id with no provider segment. Drives provider
   * preference and per-provider options.
   */
  function providerOf(modelString: string): string {
    try {
      const parsed = parseModelString(modelString);
      if (parsed.type === "intent") return "unknown";
      if (parsed.type === "direct") return parsed.provider;
      const route = classifyRoute(parsed, modelString, options);
      if (route.kind === "provider") return route.name;
      const slash = route.modelId.indexOf("/");
      return slash > 0 ? route.modelId.slice(0, slash) : "unknown";
    } catch {
      return "unknown";
    }
  }

  /**
   * Resolve a single direct or named-route model string (no intents). Throws on
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
    } else if (parsed.type === "alias") {
      const route = classifyRoute(parsed, modelString, options);
      const requested = identityOverrides?.requested ?? modelString;
      if (route.kind === "gateway") {
        const { cacheKey, gwType, apiKey } = namedGateway(route.name);
        model = resolveGatewayModel(
          cacheKey,
          gwType,
          apiKey,
          route.modelId,
          modelString,
          { requested, gateway: gwType },
          `No API key found for gateway "${route.name}". ` +
            `Set ${GATEWAY_ENV_VARS[gwType] ?? `the ${route.name} gateway API key`} environment variable.`
        );
      } else {
        model = resolvePinnedProvider(route.name, route.modelId, modelString, { requested });
      }
    } else {
      // Direct: provider/model
      const providerName = parsed.provider;
      const modelId = parsed.modelId;
      const identity = { requested: identityOverrides?.requested ?? modelString };

      const explicit = explicitProviders?.get(providerName);
      let directLanguageModel: unknown;
      let directError: unknown;
      if (explicit !== undefined) {
        try {
          directLanguageModel = explicit(modelId);
        } catch (err) {
          // Explicit factory threw (e.g. a provider that isn't loadable in a
          // bundled runtime). Don't poison directLoadFailed — that set is for
          // package-resolution failures; this failure is per-invocation.
          // Preserving the original error lets the no-gateway branch below
          // surface it instead of the generic "failed to load" message.
          directError = err;
        }
      }

      if (explicit !== undefined && directError === undefined) {
        model = wrapAiSdkModel(directLanguageModel, modelString, identity);
      } else if (explicit === undefined && isPackageProviderAvailable(providerName)) {
        // Auto-loaded provider package: available on disk, executed lazily
        // (dynamic import) on first generate/stream.
        model = createLazyGeneratorModel(modelString, async () => {
          const providerResolver = await loadPackageProvider(providerName);
          return wrapAiSdkModel(providerResolver(modelId), modelString, identity);
        });
      } else {
        // Direct path unavailable (no package, or the explicit factory threw
        // in a bundled runtime). Fall through to any configured/auto-detected
        // gateway that can serve this provider — bare `provider/model`
        // resolves "however it can".
        const gw = findGatewayForProvider(providerName);
        if (gw) {
          model = resolveGatewayModel(
            gw.cacheKey,
            gw.gatewayType,
            gw.apiKey,
            `${providerName}/${modelId}`,
            modelString,
            { ...identity, gateway: gw.gatewayType },
            `No API key found for gateway "${gw.gatewayType}" while ` +
              `falling back from direct "${providerName}".`
          );
        } else {
          const directFailed = directLoadFailed.has(providerName);
          if (directError && !directFailed) {
            throw directError;
          }
          throw noProviderError(providerName);
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

  function resolveDefaultModel(intentName: string): GeneratorModel {
    if (!options?.defaultModel) {
      throw new Error(
        `No model is configured for "intent/${intentName}": the app sets no \`models.intents.${intentName}\` ` +
          `and no \`models.default\` to fall back on. Set one where the app creates its FlowState ` +
          `(\`createFlowState({ models: { default: "<provider>/<model>" } })\`, or \`defaultModel\` on ` +
          `\`createModelResolver\`), or set the FSDEV_DEFAULT_MODEL environment variable.`
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
      const fallback = resolveDefaultModel(name);
      intentCache.set(cacheKey, fallback);
      return fallback;
    }

    const intentRequested = `intent/${name}`;
    const tagged = candidates.map((s) => ({
      modelString: s,
      providerName: providerOf(s),
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
      ? resolveDefaultModel(name)
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

  // -------------------------------------------------------------------------
  // Evaluation path (evaluator blocks)
  //
  // Same precedence as a generator string (explicit provider instance, then
  // an installed-and-keyed provider package, then a gateway), but through
  // each source's `evaluationModel(id)`. A source without one is refused
  // before any provider call. Intents are refused: an evaluator names one
  // model. The AI SDK's global default provider is never consulted.
  //
  // One exception: a `typesafe-ai/...` string always resolves through a
  // gateway (GATEWAY_ONLY_EVALUATION_PROVIDERS). `create-model-resolver-
  // evaluation-parity.test.ts` holds the two paths to the same source for
  // every other string.
  // -------------------------------------------------------------------------

  function noProviderError(providerName: string): Error {
    const directFailed = directLoadFailed.has(providerName);
    return new Error(
      `No provider available for "${providerName}". Tried: ` +
        `${directFailed ? "direct package (failed to load)" : "direct package (not installed)"}` +
        `, gateways (none configured for this provider). ` +
        `Install the provider package, set its API key, or configure a gateway ` +
        `(e.g. AI_GATEWAY_API_KEY).`
    );
  }

  /**
   * Call `source.evaluationModel(id)`, or refuse naming the source. When the
   * source was loaded from an installed package, the refusal names the
   * package: an older release of a provider or gateway package can predate
   * evaluation support while its text models still work.
   */
  function evaluationModelFrom(
    source: unknown,
    id: string,
    sourceLabel: string,
    modelString: string,
    packageName?: string
  ): EvaluationModel {
    const factory = (source as { evaluationModel?: unknown } | null | undefined)?.evaluationModel;
    if (typeof factory !== "function") {
      throw new Error(
        `${sourceLabel} does not support evaluation models, so "${modelString}" cannot be used by an evaluator. ` +
          (packageName !== undefined
            ? `The installed "${packageName}" has no evaluationModel; upgrade it to a release with evaluation support, `
            : `Use a provider or gateway with evaluation support, `) +
          `or pass an evaluation model instance.`
      );
    }
    return factory.call(source, id) as EvaluationModel;
  }

  /** The package behind a gateway, unless the app passed its own gateway instance. */
  function gatewayPackageName(cacheKey: string, gwType: string): string | undefined {
    const entry = hasRoute(options?.gateways, cacheKey) ? options!.gateways![cacheKey] : undefined;
    if (entry != null && !isGatewayConfig(entry)) return undefined;
    return GATEWAY_PACKAGES[gwType]?.pkg;
  }

  /**
   * The gateway instance registered as `cacheKey`: cached (explicit or
   * already loaded), else loaded from the package for `gwType`.
   */
  async function gatewayInstance(
    cacheKey: string,
    gwType: string,
    apiKey: string | undefined,
    missingKeyMessage: string
  ): Promise<Record<string, unknown>> {
    const cached = gatewayCache.get(cacheKey);
    if (cached !== undefined) return cached.gateway;
    if (!apiKey) throw new Error(missingKeyMessage);
    ensureGatewayPackageAvailable(gwType);
    return (await loadGateway(cacheKey, gwType, apiKey)).gateway;
  }

  /** The evaluation model from a registered or installed provider, or undefined when it has neither. */
  async function evaluationFromProvider(
    name: string,
    modelId: string,
    modelString: string
  ): Promise<EvaluationModel | undefined> {
    const explicit = hasRoute(options?.providers, name) ? options!.providers![name] : undefined;
    if (explicit !== undefined) {
      return evaluationModelFrom(explicit, modelId, `Provider "${name}"`, modelString);
    }
    if (isPackageProviderAvailable(name)) {
      const provider = await loadPackageProvider(name);
      return evaluationModelFrom(
        provider,
        modelId,
        `Provider "${name}"`,
        modelString,
        PROVIDER_PACKAGES[name]?.pkg
      );
    }
    return undefined;
  }

  async function resolveNamedEvaluationModel(route: Route, modelString: string): Promise<EvaluationModel> {
    if (route.kind === "gateway") {
      const { cacheKey, gwType, apiKey } = namedGateway(route.name);
      const gateway = await gatewayInstance(
        cacheKey,
        gwType,
        apiKey,
        `No API key found for gateway "${route.name}". ` +
          `Set ${GATEWAY_ENV_VARS[gwType] ?? `the ${route.name} gateway API key`} environment variable.`
      );
      return markEvaluationModelGateway(
        evaluationModelFrom(gateway, route.modelId, `Gateway "${route.name}"`, modelString, gatewayPackageName(cacheKey, gwType)),
        gwType
      );
    }
    const fromProvider = await evaluationFromProvider(route.name, route.modelId, modelString);
    if (fromProvider !== undefined) return fromProvider;
    throw pinnedProviderError(route.name, route.modelId, modelString);
  }

  async function resolveEvaluationModel(modelString: string): Promise<EvaluationModel> {
    const parsed = parseModelString(modelString);
    if (parsed.type === "intent") {
      throw new Error(
        `"${modelString}" is an intent. An evaluator takes one model string, not an intent.`
      );
    }
    if (parsed.type === "alias") {
      return resolveNamedEvaluationModel(classifyRoute(parsed, modelString, options), modelString);
    }
    const providerName = parsed.provider;
    const modelId = parsed.modelId;

    // A `typesafe-ai/...` string always means the gateway (spec D2), even
    // when the app registered Jev's library under `providers["typesafe-ai"]`.
    // The library names the model differently (`jev-latest`, not `jev`) and
    // bills a different account, so routing by what is registered would call
    // a different model. Direct Jev is an evaluation model instance the
    // author passes to the evaluator. This is the one place the evaluation
    // path's precedence departs from a generator string's.
    if (!GATEWAY_ONLY_EVALUATION_PROVIDERS.has(providerName)) {
      const fromProvider = await evaluationFromProvider(providerName, modelId, modelString);
      if (fromProvider !== undefined) return fromProvider;
    }
    const gw = findGatewayForProvider(providerName);
    if (gw === undefined) {
      throw noProviderError(providerName);
    }
    const gateway = await gatewayInstance(
      gw.cacheKey,
      gw.gatewayType,
      gw.apiKey,
      `No API key found for gateway "${gw.gatewayType}" while falling back from direct "${providerName}".`
    );
    return markEvaluationModelGateway(
      evaluationModelFrom(
        gateway,
        `${providerName}/${modelId}`,
        `Gateway "${gw.gatewayType}"`,
        modelString,
        gatewayPackageName(gw.cacheKey, gw.gatewayType)
      ),
      gw.gatewayType
    );
  }

  const resolver = ((
    modelId: string,
    _blockName?: string,
    callOptions?: ResolveModelCallOptions
  ): GeneratorModel => {
    const parsed = parseModelString(modelId);
    if (parsed.type === "intent") {
      return resolveIntent(parsed.intentName, callOptions);
    }
    return resolveSingleModel(modelId);
  }) as ModelResolver;

  resolver.resolveId = (
    modelId: string,
    callOptions?: { preferProvider?: ProviderPreference }
  ): string => {
    const parsed = parseModelString(modelId);
    if (parsed.type === "alias") classifyRoute(parsed, modelId, options);
    if (parsed.type !== "intent") return modelId;

    const candidates = options?.intents?.[parsed.intentName];
    if (!candidates || candidates.length === 0) {
      return options?.defaultModel ?? modelId;
    }

    const preference =
      callOptions?.preferProvider !== undefined
        ? callOptions.preferProvider
        : options?.providerPreference;

    const tagged = candidates.map((modelString) => ({
      modelString,
      providerName: providerOf(modelString),
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

  resolver.resolveEvaluationModel = (modelId: string) => resolveEvaluationModel(modelId);
  resolver.providerOf = providerOf;

  return resolver;
}
