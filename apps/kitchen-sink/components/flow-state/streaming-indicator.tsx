"use client";

import { Shimmer } from "./shimmer";

/**
 * Single-line in-flight status indicator. Renders the latest value from the
 * request-scoped status slot (via `ctx.emitStatus()` / `activeStatusMessage`)
 * with a "Working..." fallback when the slot is empty.
 *
 * When `isFinishing` is true (the main response has completed and only
 * background `.work()` tasks are still settling on the open SSE stream),
 * renders a muted "Tidying up..." label instead so the user is not misled
 * into thinking the assistant is still producing their answer.
 *
 * The leading affordance is a pulsing dot — never the brain icon, which
 * is reserved for the reasoning chrome and would visually duplicate it
 * during reasoning-on chats.
 */
export function StreamingIndicator({
  message,
  isFinishing = false,
}: {
  message?: string;
  isFinishing?: boolean;
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
    </div>
  );
}
