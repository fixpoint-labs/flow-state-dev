/**
 * Credential detection + shared constants for the xAI (Grok) provider used
 * by `get_social_sentiment`. The provider instance itself is registered in
 * `lib/server.ts`; the generator route lives in the tool file.
 *
 * The model is pinned in v1 — no costPreset tiering — so the sentiment tool
 * always pays the grok-4 price when the live route is taken.
 */

/** True when `XAI_API_KEY` is set; gates the Grok route in `get_social_sentiment`. */
export function hasXaiKey(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}

/**
 * Model id for Grok-backed sentiment. The resolver registers `xai` as a
 * direct provider when `XAI_API_KEY` is present, which makes this id
 * resolvable. Pinned to one model in v1 (no costPreset tiering).
 *
 * The resolver registers `xai` against the **responses** model rather
 * than the default chat model — xSearch (the X/Twitter retrieval tool the
 * sentiment generator depends on) is only supported on the responses API.
 */
export const XAI_SENTIMENT_MODEL = "xai/grok-4-fast-reasoning";
