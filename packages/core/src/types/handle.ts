/**
 * HandleProvider — contract for obtaining live SDK handles from persisted identity keys.
 *
 * External agent SDKs (Claude Code SDK, Gemini, etc.) maintain runtime state
 * that cannot be serialized into session state. HandleProvider bridges the gap:
 * blocks persist an external session ID in session state, then use a provider
 * to reconstruct or retrieve a live handle on subsequent requests.
 *
 * @example
 * ```typescript
 * const provider: HandleProvider<ClaudeSession> = {
 *   resolve: async (key) => new ClaudeSession({ sessionId: key }),
 *   release: async (key) => { // optional cleanup },
 * };
 *
 * // Inside a handler block:
 * const handle = await provider.resolve(ctx.session.state.externalSessionId);
 * ```
 */
export interface HandleProvider<THandle> {
  /**
   * Obtain or reconstruct a handle from a persisted key.
   *
   * Must be idempotent: calling resolve() twice with the same key
   * should return equivalent handles (or the same cached instance).
   */
  resolve(key: string): Promise<THandle>;

  /**
   * Release a handle when it is no longer needed.
   * Called on explicit cleanup, TTL eviction, or process shutdown.
   */
  release?(key: string): Promise<void>;
}

/** Configuration for {@link HandleProvider} caching behavior. */
export interface HandleCacheOptions<THandle> {
  /** The underlying provider that creates/reconstructs handles. */
  provider: HandleProvider<THandle>;

  /** Maximum number of cached handles (LRU eviction). */
  maxSize?: number;

  /** Time-to-live in milliseconds. Entries expire after this duration of inactivity. */
  ttlMs?: number;

  /** Called when an entry is evicted (TTL, LRU, or explicit release). */
  onEvict?: (key: string, handle: THandle) => void;
}
