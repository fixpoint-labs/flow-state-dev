/**
 * Control `no-retry`: the projects' writes with their own retry removed.
 *
 * Loaded into the served Lab in place of `packages/workforce/src/projects/
 * cas-retry.ts` (`swap-loader.mjs`). Each contended write gets one attempt,
 * the engine's own three, and no more: a workstream entry's updates and the
 * write that names its session. With the Lab's store writes held
 * (`write-latency.mts`), the race's updates lose writes and "a write race
 * lands whole" fails.
 */

/** One attempt: a write that loses its race throws. */
export async function retryOnConflict<T>(write: () => Promise<T>, _options: { attempts?: number; baseDelayMs?: number } = {}): Promise<T> {
  return write();
}
