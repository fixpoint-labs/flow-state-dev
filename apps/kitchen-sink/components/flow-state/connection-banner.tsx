"use client";

/**
 * A thin bar that says the server is gone, and the stale styling that goes
 * with it. Both read one function, {@link isFeedStale}, over the session
 * feed's `state` (`sessionFeed` in `@flow-state-dev/client`), so the bar and
 * every greyed status line agree on when what is drawn stopped being current.
 *
 * The bar draws on `lapsed` (a retry has failed) and `stopped` (the feed will
 * not come back). It draws nothing on `connecting`, a first load, or on
 * `reconnecting`, the server's ordinary close that the first retry fixes.
 */
import { useEffect, useRef, useState } from "react";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** The session feed's states, as `sessionFeed` reports them. */
export type ConnectionFeedState = "connecting" | "live" | "reconnecting" | "lapsed" | "stopped";

/**
 * Whether what a feed last said may be out of date: a retry has failed, or
 * the feed has stopped. The one definition the bar and stale styling share.
 */
export function isFeedStale(state: ConnectionFeedState): boolean {
  return state === "lapsed" || state === "stopped";
}

/**
 * Classes for an area whose status lines are stale: greyed, with its pulsing
 * dots and spinners stopped. Add it where status is drawn, while
 * {@link isFeedStale} is true.
 */
export const STALE_CLASS = "opacity-60 grayscale [&_.animate-pulse]:animate-none [&_.animate-spin]:animate-none";

/** "12s", "3m", "1h". */
function since(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

/**
 * The bar. `feed` is anything with the feed's `state`: a `sessionFeed`
 * snapshot, or an app's own read reporting in the same vocabulary.
 *
 * @param onRetry Offered on `stopped` only: the app reopens its feed.
 *   Absent, a stopped feed's bar has no button.
 */
export function ConnectionBanner({
  feed,
  onRetry,
  className
}: {
  feed: { state: ConnectionFeedState };
  onRetry?: () => void;
  className?: string;
}) {
  const stale = isFeedStale(feed.state);
  // When the feed last left `live`: the age of what is on screen. The feed
  // carries no time, so the bar keeps it.
  const leftLive = useRef<number | null>(null);
  if (feed.state === "live") {
    leftLive.current = null;
  } else if (leftLive.current === null) {
    leftLive.current = Date.now();
  }
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!stale) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [stale]);

  if (!stale) return null;
  const age = since(now - (leftLive.current ?? now));

  return (
    <div role="status" data-testid="connection-banner" data-state={feed.state} className={cn("px-3 pt-2", className)}>
      <div className="flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm">
        <span className="flex items-center gap-2 text-warning">
          <WifiOff className="h-4 w-4 shrink-0" />
          {feed.state === "lapsed"
            ? `Lost the server ${age} ago, retrying…`
            : `The server stopped this feed ${age} ago. What you see is the last it sent.`}
        </span>
        {feed.state === "stopped" && onRetry !== undefined ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
