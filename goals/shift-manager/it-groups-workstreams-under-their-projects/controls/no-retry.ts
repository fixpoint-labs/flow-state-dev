/**
 * Control `no-retry`: the room's writes with their own retry removed.
 *
 * Loaded into the served Lab in place of `packages/workforce/src/projects/
 * cas-retry.ts` (`swap-loader.mjs`). Each contended write gets one attempt,
 * the engine's own three, and no more: the room's sequence counter and the
 * `sessions` list a join appends to. See goal.md for what this control shows
 * in the served host today.
 */

/** One attempt: a write that loses its race throws. */
export async function retryOnConflict<T>(write: () => Promise<T>, _options: { attempts?: number; baseDelayMs?: number } = {}): Promise<T> {
  return write();
}
