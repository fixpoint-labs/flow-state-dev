import type { GeneratorModel } from "../types/model";

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
// Model group config
// ---------------------------------------------------------------------------

export interface ModelGroupConfig {
  /** Ordered preference list. Format: 'provider/model-id'. */
  models: string[];
  /** Default generation settings for this group. User config wins. */
  defaults?: ModelGroupDefaults;
}

export interface ModelGroupDefaults {
  maxTokens?: number;
  /** Per-provider options (only applied when the resolved model matches the provider). */
  providerOptions?: Record<string, Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Provider factory config
// ---------------------------------------------------------------------------

export interface FSDProviderConfig {
  /** Model groups. Keys are group names ('fast', 'thinking', etc.). */
  groups: Record<string, ModelGroupConfig>;
  /**
   * AI SDK provider instances. Keys are provider prefixes used in model strings.
   * If omitted, auto-creates providers from env vars.
   */
  providers?: Record<string, unknown>;
  /**
   * Explicit API keys. Overrides env var detection.
   * Format: { anthropic: 'sk-...', openai: 'sk-...', google: '...' }
   */
  keys?: Partial<Record<string, string>>;
  /** Gateway providers that can route to multiple backends. */
  gateways?: Record<string, GatewayEntry>;
  /** Retry policy for failed model calls. */
  retryPolicy?: RetryPolicy;
  /**
   * Default provider preference applied when a call-site `ResolveOptions.prefer`
   * is omitted. Accepts a provider name or an ordered list. The resolver
   * performs a stable reorder of the group's model list: preferred buckets
   * first (in the order given), remaining models after, in their original
   * relative order. Fully backward-compatible — omitting this preserves the
   * preset/group author's ordering.
   */
  providerPreference?: ProviderPreference;
}

// ---------------------------------------------------------------------------
// Provider preference (FIX-425)
// ---------------------------------------------------------------------------

/**
 * Brand preference axis: a provider name ("anthropic") or an ordered list
 * of provider names (["anthropic", "google"]). Orthogonal to the preset/tier
 * axis — the preset defines the candidate pool; preference reorders it.
 */
export type ProviderPreference = string | string[];

/**
 * Options passed to a provider call site to influence model resolution
 * without editing the preset definition.
 */
export interface ResolveOptions {
  /** Preferred provider(s). Overrides any provider-level default when set. */
  prefer?: ProviderPreference;
  /**
   * When true, throws if no model from the preferred providers is available.
   * When false (default), falls back to the full preset in its natural order.
   */
  strict?: boolean;
}

/**
 * One row returned by {@link FSDProvider.explain}. Reflects the resolver's
 * decision for a single candidate model, including whether it is available
 * and why.
 */
export interface ExplainCandidate {
  /** Model string in `provider/model-id` form, verbatim from the group. */
  modelId: string;
  /** Provider prefix extracted from `modelId`. */
  providerName: string;
  /** Whether the resolver can construct a working model for this entry. */
  available: boolean;
  /** How this model would be reached when available. */
  source?: "key" | "gateway";
  /** Gateway name when `source === "gateway"`. */
  gateway?: string;
  /** Short reason when `available === false`. */
  reason?: string;
}

/**
 * Introspection output describing what a provider call will do, before it is
 * used. Useful for debugging, UI selectors, and spec authoring.
 */
export interface ExplainResult {
  /** The group (or preset) name that was resolved. */
  preset: string;
  /**
   * The normalized preference list (after dedupe / empty-entry removal). An
   * empty array means "no preference" — the preset's natural order is used.
   */
  prefer: string[];
  /** Candidates in the order the fallback chain would walk them. */
  candidates: ExplainCandidate[];
  /** The first available candidate's model string, or `null` when none. */
  willUse: string | null;
}

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

// ---------------------------------------------------------------------------
// FSD Provider callable
// ---------------------------------------------------------------------------

export interface FSDProvider {
  /**
   * Get a GeneratorModel for a named group. Optional `ResolveOptions.prefer`
   * reorders the group's models by provider before availability filtering and
   * fallback. Call-site `prefer` overrides any provider-level default.
   */
  (groupName: string, options?: ResolveOptions): GeneratorModel;
  /** Explicit form: get a language model for a named group. */
  languageModel(groupName: string, options?: ResolveOptions): GeneratorModel;
  /** List available groups. */
  groups(): string[];
  /**
   * Check which models in a group are available. When `options.prefer` is
   * supplied, the returned list is ordered after the preference reorder
   * (same order the fallback chain will walk).
   */
  available(groupName: string, options?: ResolveOptions): string[];
  /**
   * Describe the candidate list and resolver decision for a group. See
   * {@link ExplainResult}.
   */
  explain(groupName: string, options?: ResolveOptions): ExplainResult;
}
