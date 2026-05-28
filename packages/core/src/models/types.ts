// ---------------------------------------------------------------------------
// Provider names
// ---------------------------------------------------------------------------

export const providerNames = ["anthropic", "openai", "google"] as const;
export type ProviderName = (typeof providerNames)[number];

// ---------------------------------------------------------------------------
// Gateway types
// ---------------------------------------------------------------------------

export const gatewayTypes = ["vercel", "openrouter"] as const;
export type GatewayType = (typeof gatewayTypes)[number];

// ---------------------------------------------------------------------------
// Fallback-model internal merge type
// ---------------------------------------------------------------------------

/**
 * Internal merge type used by `createFallbackModel` to apply per-provider
 * defaults under call-site options. Not part of the public API — the public
 * surface for per-intent defaults is {@link IntentDefaults}.
 *
 * `providerOptions` is filtered by the resolved candidate's provider name
 * before merging, so keys for other providers are dropped silently.
 */
export interface ModelGroupDefaults {
  maxTokens?: number;
  /** Per-provider options (only applied when the resolved model matches the provider). */
  providerOptions?: Record<string, Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Intent defaults (FIX-633)
// ---------------------------------------------------------------------------

/**
 * Per-intent defaults applied when a candidate from that intent wins
 * resolution. The resolved candidate's provider is used to filter
 * `providerOptions` — keys for other providers are dropped silently
 * (matches the Vercel AI SDK's per-provider namespace behavior).
 *
 * Call-site `providerOptions` (passed by a generator at execution time)
 * always wins on key collisions. Nested provider-namespace objects are
 * deep-merged.
 *
 * Captured at resolver construction time — the resolved fallback model
 * is immutable. Mutations to `intentDefaults` after `createModelResolver`
 * has been called do not affect already-resolved intents (intents are
 * cached by `(name, normalizedPreference)`).
 *
 * Open shape so future fields (reasoning, caching, etc.) can be added
 * without a breaking change.
 */
export interface IntentDefaults {
  /**
   * Per-provider options merged into the request when a candidate from
   * the intent's list wins. Only the resolved provider's sub-object is
   * kept; others are dropped.
   */
  providerOptions?: Record<string, Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Legacy createFSDProvider types — tombstoned in FIX-633
// ---------------------------------------------------------------------------

/** @deprecated Removed in FIX-633. Migrate to createModelResolver({ intents, intentDefaults }). */
export type FSDProvider = never;
/** @deprecated Removed in FIX-633. */
export type FSDProviderConfig = never;
/** @deprecated Removed in FIX-633. Use `{ intents: Record<string, string[]> }` on createModelResolver instead. */
export type ModelGroupConfig = never;
/** @deprecated Removed in FIX-633. Use ResolveModelCallOptions instead. */
export type ResolveOptions = never;
/** @deprecated Removed in FIX-633. */
export type ExplainCandidate = never;
/** @deprecated Removed in FIX-633. */
export type ExplainResult = never;

// ---------------------------------------------------------------------------
// Provider preference (FIX-425)
// ---------------------------------------------------------------------------

/**
 * Brand preference axis: a provider name ("anthropic") or an ordered list
 * of provider names (["anthropic", "google"]). Orthogonal to the intent
 * axis — the intent defines the candidate pool; preference reorders it.
 */
export type ProviderPreference = string | string[];

export interface GatewayConfig {
  type: GatewayType;
  apiKey?: string;
}

/**
 * Gateway value: either a config object for auto-detection, or a pre-created
 * gateway instance (e.g., `createGateway({ apiKey })`). Instances bypass
 * dynamic package loading — essential for bundled environments like Next.js.
 */
export type GatewayEntry = GatewayConfig | unknown;

export interface RetryPolicy {
  /** Max attempts per model before falling back. Default: 2. */
  maxAttemptsPerModel?: number;
  /** Base delay between retries in ms. Default: 1000. */
  baseDelayMs?: number;
  /** Max delay between retries in ms. Default: 10000. */
  maxDelayMs?: number;
}

