import { useEffect, useState } from "react";
import type { Unsubscribe } from "../adapter";

/**
 * The latest value a `watch*` verb reports, re-subscribing when `deps` change.
 * `undefined` until the first report.
 */
export function useWatch<T>(subscribe: (onChange: (value: T) => void) => Unsubscribe, deps: readonly unknown[]): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    setValue(undefined);
    return subscribe(setValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/** The current time, in ms, re-read every `everyMs` while `active`. */
export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
  return now;
}

/** "now", "5m ago", "2h ago", "yesterday", "3d ago". */
export function age(fromMs: number, nowMs: number): string {
  const minutes = Math.floor((nowMs - fromMs) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/** "0:42", "12:05": elapsed time as minutes and seconds. */
export function elapsed(fromMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
