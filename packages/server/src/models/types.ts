import type { GeneratorModel } from "@flow-state-dev/core/types";

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
  /** Ordered preference list. Format: 'provider:model-id'. */
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
  gateways?: Record<string, GatewayConfig>;
  /** Retry policy for failed model calls. */
  retryPolicy?: RetryPolicy;
}

export interface GatewayConfig {
  type: GatewayType;
  apiKey?: string;
}

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
  /** Get a GeneratorModel for a named group. */
  (groupName: string): GeneratorModel;
  /** Explicit form: get a language model for a named group. */
  languageModel(groupName: string): GeneratorModel;
  /** List available groups. */
  groups(): string[];
  /** Check which models in a group are available. */
  available(groupName: string): string[];
}
