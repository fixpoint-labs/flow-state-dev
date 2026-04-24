/**
 * Prompt caching translation for the AI SDK request layer.
 *
 * Anthropic's prompt cache is explicit — a request only hits cache when a
 * message part carries `providerOptions.anthropic.cacheControl`. OpenAI,
 * Google, and DeepSeek cache implicitly. The Vercel AI Gateway can mark
 * breakpoints on behalf of any provider when told to do so.
 *
 * This module owns that translation. The generator block records a
 * framework-level `caching` config; the request builder calls `applyCaching`
 * to turn that into the correct per-provider markers right before the
 * request is dispatched. Users who set their own `cacheControl` markers in
 * `manual` mode, or directly on messages, are never overwritten.
 */

import type { CachingConfig } from "../types/model";

export type { CachingConfig, CachingTtl, CachingBreakpointMode } from "../types/model";

/** Defaults applied when the generator omits a field (or the whole config). */
export const DEFAULT_CACHING_CONFIG: Required<CachingConfig> = {
  enabled: true,
  breakpoints: "auto",
  ttl: "5m",
};

/**
 * Anthropic's minimum cacheable prefix is ~1024 tokens for Sonnet/Opus
 * (2048 for Haiku). Below that threshold the API rejects the cache_control
 * marker silently; marking anyway burns cache creation cost with no payoff.
 * Char-based heuristic (~4 chars/token) avoids a tokenizer dependency.
 */
const MIN_CACHEABLE_CHARS = 1024 * 4;

/**
 * Detected provider family. Drives which marker flavor we emit:
 * - `anthropic` / `openrouter` → message + tool `providerOptions.anthropic.cacheControl`
 * - `gateway` → request-level `providerOptions.gateway.caching: 'auto'`
 * - anything else → no-op (implicit caching)
 */
type ProviderFamily = "anthropic" | "openrouter" | "gateway" | "other";

/**
 * Applies cache markers to an AI SDK request in place based on the
 * framework's caching config and the resolved language model's provider.
 * Called by `buildAiSdkRequest` right before dispatch. Safe to call with
 * any config (including undefined) and any model.
 */
export function applyCaching(
  request: Record<string, unknown>,
  config: CachingConfig | undefined,
  languageModel: unknown,
): void {
  const effective = resolveEffectiveCaching(config);
  if (!effective.enabled) return;
  if (effective.breakpoints === "manual") return;

  const family = detectProviderFamily(languageModel);
  if (family === "other") return;

  if (family === "gateway") {
    setProviderOptionIfAbsent(request, "gateway", "caching", "auto");
    return;
  }

  // Anthropic-flavored: direct Anthropic or OpenRouter (which proxies
  // cache_control markers to Anthropic models unchanged).
  if (!meetsMinimumPrefixSize(request)) return;

  const target = findLastSystemMessage(request.messages);
  if (target === undefined) return;
  setProviderOptionIfAbsent(target, "anthropic", "cacheControl", {
    type: "ephemeral",
    ttl: effective.ttl,
  });
}

function resolveEffectiveCaching(
  config: CachingConfig | undefined,
): Required<CachingConfig> {
  if (config === undefined) return { ...DEFAULT_CACHING_CONFIG };
  return {
    enabled: config.enabled ?? DEFAULT_CACHING_CONFIG.enabled,
    breakpoints: config.breakpoints ?? DEFAULT_CACHING_CONFIG.breakpoints,
    ttl: config.ttl ?? DEFAULT_CACHING_CONFIG.ttl,
  };
}

/**
 * Detects the provider family from an AI SDK language model. AI SDK
 * language models expose `provider` as `<name>.<submode>` (e.g.
 * `anthropic.chat`, `gateway.chat`). Gateway instances always report as
 * `gateway.*` even when they route to Anthropic underneath, which is the
 * signal we use to delegate breakpoint placement to the gateway.
 */
function detectProviderFamily(languageModel: unknown): ProviderFamily {
  const provider = (languageModel as { provider?: unknown } | undefined)?.provider;
  if (typeof provider !== "string") return "other";

  const dotIndex = provider.indexOf(".");
  const name = (dotIndex > 0 ? provider.slice(0, dotIndex) : provider).toLowerCase();

  if (name === "anthropic") return "anthropic";
  if (name === "openrouter") return "openrouter";
  if (name === "gateway") return "gateway";
  return "other";
}

/**
 * Sets `target.providerOptions[providerName][key] = value` immutably,
 * preserving any existing provider options and never overwriting an
 * existing entry at the same key. Used both for per-message Anthropic
 * cacheControl and for request-level gateway caching delegation.
 */
function setProviderOptionIfAbsent(
  target: Record<string, unknown>,
  providerName: string,
  key: string,
  value: unknown,
): void {
  const options = asRecord(target.providerOptions) ?? {};
  const providerOpts = asRecord(options[providerName]) ?? {};
  if (key in providerOpts) return;

  target.providerOptions = {
    ...options,
    [providerName]: { ...providerOpts, [key]: value },
  };
}

/**
 * Walks the messages array from the end to find the last system-role
 * message. Returns the message record so the caller can mutate it
 * directly. `undefined` when no system message is present.
 */
function findLastSystemMessage(messages: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const record = asRecord(messages[i]);
    if (record?.role === "system") return record;
  }
  return undefined;
}

/**
 * Estimates whether the cacheable prefix (system messages + tool
 * definitions) is large enough to be worth caching. Char-count heuristic;
 * errs on the side of marking. JSON.stringify can throw on a tool whose
 * schema has circular references — when that happens we conservatively
 * skip that tool's contribution rather than failing the whole call.
 */
function meetsMinimumPrefixSize(request: Record<string, unknown>): boolean {
  let chars = 0;

  if (Array.isArray(request.messages)) {
    for (const message of request.messages) {
      const record = asRecord(message);
      if (record?.role === "system") chars += contentCharLength(record.content);
    }
  }

  const tools = asRecord(request.tools);
  if (tools !== undefined) {
    for (const tool of Object.values(tools)) {
      try {
        chars += JSON.stringify(tool).length;
      } catch {
        // Best-effort estimate — skip this tool's contribution.
      }
    }
  }

  return chars >= MIN_CACHEABLE_CHARS;
}

function contentCharLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let sum = 0;
  for (const part of content) {
    const record = asRecord(part);
    if (typeof record?.text === "string") sum += record.text.length;
  }
  return sum;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
