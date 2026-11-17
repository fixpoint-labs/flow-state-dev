/**
 * Each session's Stop under way, shared by the call that stops a session
 * (`interrupt`, `calls.ts`) and the thread that shows it stopping
 * (`useThread`, `sessions.ts`).
 */

/** Each session's Stop under way: the turns it aborted (`null` while it reads which), until each has ended. */
export class Stops {
  private readonly stops = new Map<string, { ids: Set<string> | null }>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  get(sessionId: string) {
    return this.stops.get(sessionId);
  }
  set(sessionId: string, stop: { ids: Set<string> | null } | undefined) {
    if (stop === undefined) this.stops.delete(sessionId);
    else this.stops.set(sessionId, stop);
    this.version += 1;
    for (const tell of [...this.listeners]) tell();
  }
  // fallow-ignore-next-line unused-class-member -- read by `useThread` (`sessions.ts`) through `useSyncExternalStore`.
  subscribe = (tell: () => void) => {
    this.listeners.add(tell);
    return () => this.listeners.delete(tell);
  };
  // fallow-ignore-next-line unused-class-member -- read by `useThread` (`sessions.ts`) through `useSyncExternalStore`.
  snapshot = () => this.version;
}
