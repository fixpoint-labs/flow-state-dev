import { useEffect, useState } from "react";

export function useRelativeTime(timestamp: number | null): string {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (timestamp === null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [timestamp]);

  if (timestamp === null) return "Not yet loaded";

  const diff = Math.max(0, now - timestamp);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours}h ago`;
}
