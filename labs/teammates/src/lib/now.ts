import { useEffect, useState, useSyncExternalStore } from "react";
import { useAppClient } from "../app/provider";
import { isFeedStale } from "../components/flow-state/connection-banner";

/**
 * The current time, in ms, re-read every `everyMs`. With `running` false it
 * holds where it was, so an age drawn from it stops with the data. When it
 * starts again (or its pace changes) it re-reads at once, so a resumed clock
 * never draws one interval from the time it stopped at.
 */
export function useNow(everyMs = 30_000, running = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs, running]);
  return now;
}

/**
 * Whether a conversation's feed has lost the server, so what it last said may
 * be out of date. Read from the app's conversation store, not `../app`, so a
 * card the app's renderers draw can ask without an import cycle.
 */
export function useStale(sessionId: string | undefined): boolean {
  const { conversations } = useAppClient();
  const connection = useSyncExternalStore(conversations.subscribe, () => (sessionId === undefined ? undefined : conversations.read(sessionId)?.connection));
  return connection !== undefined && isFeedStale(connection);
}

/** "now", "5m", "2h", "3d": how long ago, for a status line. */
export function age(fromMs: number, nowMs: number): string {
  const minutes = Math.floor((nowMs - fromMs) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
