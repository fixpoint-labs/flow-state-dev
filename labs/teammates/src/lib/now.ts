import { useEffect, useState } from "react";

/**
 * The current time, in ms, re-read every `everyMs`. With `running` false it
 * holds where it was, so an age drawn from it stops with the data.
 */
export function useNow(everyMs = 30_000, running = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs, running]);
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