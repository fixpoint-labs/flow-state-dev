"use client";

import { useEffect, useState } from "react";
import { Shimmer } from "./shimmer";

/** "42s", "1m 24s", "1h 3m": the short form a terminal agent prints, not a sentence. */
function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * How long a request has been running, counted up each second from `since`
 * (epoch ms; the request's first item). Reads "(1m 24s)". Renders nothing
 * until a full second has passed. The clock is the browser's, so a skewed
 * server timestamp is clamped to zero rather than shown negative.
 */
function RunTimer({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, now - since);
  if (elapsed < 1000) return null;
  return <span data-testid="run-timer" className="tabular-nums">({formatElapsed(elapsed)})</span>;
}

/**
 * What a finished request leaves where the indicator was: "Worked for 3m 24s •
 * 4:28 PM", the time it took and the clock time it ended. Renders nothing for a
 * request that took under a second. `endedAt` is only as good as the caller's
 * source for it (see `RequestGroupRendererProps.latestCompletedAtMs`).
 */
export function WorkedFor({ startedAt, endedAt }: { startedAt: number; endedAt: number }) {
  const elapsed = Math.max(0, endedAt - startedAt);
  if (elapsed < 1000) return null;
  const endedAtLabel = new Date(endedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <div data-testid="worked-for" className="px-1 py-2 text-muted-foreground text-sm tabular-nums">
      Worked for {formatElapsed(elapsed)} • {endedAtLabel}
    </div>
  );
}

/**
 * Single-line in-flight status indicator. Renders the latest value from the
 * request-scoped status slot (via `ctx.emit.status()` / `activeStatusMessage`)
 * with a "Working..." fallback when the slot is empty.
 *
 * When `isFinishing` is true (the main response has completed and only
 * background `.sideChain()` tasks are still settling on the open SSE stream),
 * renders a muted "Tidying up..." label instead so the user is not misled
 * into thinking the assistant is still producing their answer.
 *
 * Pass `since` to show how long the request has been running beside the label.
 *
 * The leading affordance is a pulsing dot — never the brain icon, which
 * is reserved for the reasoning chrome and would visually duplicate it
 * during reasoning-on chats.
 */
export function StreamingIndicator({
  message,
  isFinishing = false,
  since,
}: {
  message?: string;
  isFinishing?: boolean;
  /** Epoch ms the request began; shows an elapsed timer when set. */
  since?: number;
}) {
  const label = isFinishing
    ? "Tidying up..."
    : message && message.length > 0
      ? message
      : "Working...";
  return (
    <div
      data-testid="streaming-indicator"
      data-state={isFinishing ? "finishing" : undefined}
      className={
        isFinishing
          ? "flex items-center gap-2 px-1 py-2 text-muted-foreground text-sm opacity-60"
          : "flex items-center gap-2 px-1 py-2 text-muted-foreground text-sm"
      }
    >
      <span className="inline-block size-2 rounded-full bg-current animate-pulse" />
      {isFinishing ? <span>{label}</span> : <Shimmer duration={1}>{label}</Shimmer>}
      {since !== undefined && <RunTimer since={since} />}
    </div>
  );
}
