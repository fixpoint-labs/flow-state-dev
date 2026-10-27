/**
 * A model result's cache token counts, read one way everywhere a result is
 * counted: the request's spend ledger and the trace rows.
 */

/**
 * The cache read and cache creation tokens a model result reports. Prefers
 * the adapter-normalised usage fields and falls back to raw Anthropic provider
 * metadata, which older call paths still carry. `undefined` where neither says.
 */
export function cacheTokensOf(
  usage: { cacheReadInputTokens?: number; cacheCreationInputTokens?: number },
  providerMetadata: Record<string, Record<string, unknown>> | undefined
): { read: number | undefined; creation: number | undefined } {
  const anthropic = providerMetadata?.anthropic ?? {};
  return {
    read:
      usage.cacheReadInputTokens ??
      (typeof anthropic.cacheReadInputTokens === "number" ? anthropic.cacheReadInputTokens : undefined),
    creation:
      usage.cacheCreationInputTokens ??
      (typeof anthropic.cacheCreationInputTokens === "number" ? anthropic.cacheCreationInputTokens : undefined)
  };
}
