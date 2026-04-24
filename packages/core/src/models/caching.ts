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

import type { CachingConfig, CachingTtl } from "../types/model";

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
    applyGatewayCaching(request);
    return;
  }

  // Anthropic-flavored: direct Anthropic or OpenRouter (which proxies
  // cache_control markers to Anthropic models unchanged).
  if (!meetsMinimumPrefixSize(request)) return;
  markLastSystemMessage(request, effective.ttl);
}

/** Merges user config with defaults. Exported for tests and docs tooling. */
export function resolveEffectiveCaching(
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
  const model = languageModel as Record<string, unknown> | undefined;
  const provider = model?.provider;
  if (typeof provider !== "string") return "other";

  const dotIndex = provider.indexOf(".");
  const name = (dotIndex > 0 ? provider.slice(0, dotIndex) : provider).toLowerCase();

  if (name === "anthropic") return "anthropic";
  if (name === "openrouter") return "openrouter";
  if (name === "gateway") return "gateway";
  return "other";
}

/**
 * Delegates breakpoint placement to the Vercel AI Gateway via
 * `providerOptions.gateway.caching: 'auto'`. Gateway auto-marks for
 * providers that need it (Anthropic) and no-ops elsewhere. We never
 * overwrite an explicit `caching` value set by the caller.
 */
function applyGatewayCaching(request: Record<string, unknown>): void {
  const existingOpts = asOptionsRecord(request.providerOptions) ?? {};
  const existingGateway = asRecord(existingOpts.gateway) ?? {};
  if ("caching" in existingGateway) return;

  request.providerOptions = {
    ...existingOpts,
    gateway: { ...existingGateway, caching: "auto" },
  };
}

/**
 * Checks whether the combined system + tools prefix is large enough to be
 * worth caching. Uses a char-count heuristic; err on the side of marking.
 */
function meetsMinimumPrefixSize(request: Record<string, unknown>): boolean {
  let chars = 0;

  const messages = request.messages;
  if (Array.isArray(messages)) {
    for (const message of messages) {
      const record = asRecord(message);
      if (record === undefined) continue;
      if (record.role !== "system") continue;
      chars += contentCharLength(record.content);
    }
  }

  const tools = asRecord(request.tools);
  if (tools !== undefined) {
    for (const tool of Object.values(tools)) {
      try {
        chars += JSON.stringify(tool).length;
      } catch {
        // Tools with non-serializable values (e.g., closures) still contribute
        // their descriptions; fall back to a best-effort length.
        const rec = asRecord(tool);
        if (typeof rec?.description === "string") chars += rec.description.length;
      }
    }
  }

  return chars >= MIN_CACHEABLE_CHARS;
}

/**
 * Marks the last system message with an Anthropic ephemeral cache_control.
 * Anthropic applies the marker cumulatively, so placing it on the trailing
 * system part caches tools + system together — the prime stable prefix.
 * Skips if the user already set a cacheControl at that point.
 */
function markLastSystemMessage(
  request: Record<string, unknown>,
  ttl: CachingTtl,
): void {
  const messages = request.messages;
  if (!Array.isArray(messages)) return;

  let lastSystemIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const record = asRecord(messages[i]);
    if (record?.role === "system") {
      lastSystemIndex = i;
      break;
    }
  }
  if (lastSystemIndex === -1) return;

  const target = messages[lastSystemIndex] as Record<string, unknown>;
  stampCacheControl(target, ttl);
}

/**
 * Sets `providerOptions.anthropic.cacheControl` on a message-like record,
 * preserving any existing provider options and never overwriting a user's
 * own cacheControl entry.
 */
function stampCacheControl(target: Record<string, unknown>, ttl: CachingTtl): void {
  const options = asOptionsRecord(target.providerOptions) ?? {};
  const anthropic = asRecord(options.anthropic) ?? {};
  if ("cacheControl" in anthropic || "cache_control" in anthropic) return;

  target.providerOptions = {
    ...options,
    anthropic: {
      ...anthropic,
      cacheControl: { type: "ephemeral", ttl },
    },
  };
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

function asOptionsRecord(
  value: unknown,
): Record<string, Record<string, unknown>> | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  return record as Record<string, Record<string, unknown>>;
}
