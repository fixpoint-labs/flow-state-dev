/**
 * BindingProvider — contract for obtaining live SDK bindings from persisted identity keys.
 *
 * External agent SDKs (Claude Code SDK, Gemini, etc.) maintain runtime state
 * that cannot be serialized into session state. BindingProvider bridges the gap:
 * blocks persist an external session ID in session state, then use a provider
 * to reconstruct or retrieve a live binding on subsequent requests.
 *
 * @example
 * ```typescript
 * const provider: BindingProvider<ClaudeSession> = {
 *   resolve: async (key) => new ClaudeSession({ sessionId: key }),
 *   release: async (key) => { // optional cleanup },
 * };
 *
 * // Inside a handler block:
 * const session = await provider.resolve(ctx.session.state.externalSessionId);
 * ```
 */
export interface BindingProvider<TBinding> {
  /**
   * Obtain or reconstruct a binding from a persisted key.
   *
   * Must be idempotent: calling resolve() twice with the same key
   * should return equivalent bindings (or the same cached instance).
   */
  resolve(key: string): Promise<TBinding>;

  /**
   * Release a binding when it is no longer needed.
   * Called on explicit cleanup, TTL eviction, or process shutdown.
   */
  release?(key: string): Promise<void>;
}

/** Configuration for {@link BindingProvider} caching behavior. */
export interface BindingCacheOptions<TBinding> {
  /** The underlying provider that creates/reconstructs bindings. */
  provider: BindingProvider<TBinding>;

  /** Maximum number of cached bindings (LRU eviction). */
  maxSize?: number;

  /** Time-to-live in milliseconds. Entries expire after this duration of inactivity. */
  ttlMs?: number;

  /** Called when an entry is evicted (TTL, LRU, or explicit release). */
  onEvict?: (key: string, binding: TBinding) => void;
}
