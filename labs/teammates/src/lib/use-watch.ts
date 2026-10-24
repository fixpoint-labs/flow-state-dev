import { useEffect, useState } from "react";
import type { Unsubscribe } from "../adapter";

/**
 * The latest value a keyed `watch*` reports. `undefined` until the first
 * report, and while `key` is missing.
 */
export function useWatch<T>(watch: (key: string, onChange: (value: T) => void) => Unsubscribe, key: string | undefined): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    setValue(undefined);
    if (key === undefined) return;
    return watch(key, setValue);
  }, [watch, key]);
  return value;
}

/** The current time, in ms, re-read every `everyMs`. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** "now", "5m", "2h", "3d": how long ago, for a status line. */
export function age(fromMs: number, nowMs: number): string {
  const minutes = Math.floor((nowMs - fromMs) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
