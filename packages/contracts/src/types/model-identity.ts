/**
 * Identity of a model that actually executed a generator call. Pure shape
 * with no runtime dependencies — extracted from `core/types/model.ts` (which
 * mixes zod-typed model-definition types) so the item taxonomy can carry it
 * without pulling the heavy authoring runtime. `core/types/model` re-exports
 * this type from its original path.
 */

/**
 * Identity of a model that actually executed a generator call. Surfaced on
 * generator-emitted items and on `BlockTraceItem` so consumers can answer
 * "which model produced this?" without consulting internal/debug surfaces.
 *
 * `actual` is always populated. `requested` and `gateway` appear only when
 * meaningful (intent fallback, gateway-routed call, provider substitution).
 */
export interface ModelIdentity {
  /**
   * The concrete model that actually executed the call. Prefers the
   * provider-reported model id (e.g. `gpt-5.5-2025-04-12`); falls back to
   * the framework's winning candidate string (e.g. `openai/gpt-5.5`) when
   * the provider doesn't report one.
   */
  actual: string;
  /**
   * What the caller requested, when different from `actual`. Populated for
   * intent strings (`intent/chat`), for non-first candidates inside a
   * fallback chain, and when the provider reports a different model id
   * than the framework requested. Omitted when equal to `actual`.
   */
  requested?: string;
  /** The gateway that routed the call, when one was used. */
  gateway?: string;
}
