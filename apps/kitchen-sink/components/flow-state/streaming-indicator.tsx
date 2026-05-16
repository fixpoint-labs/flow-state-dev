"use client";

import { BrainIcon } from "lucide-react";
import { Shimmer } from "./shimmer";

/**
 * Single-line in-flight status indicator. Renders the latest value from the
 * request-scoped status slot (via `ctx.emitStatus()` / `activeStatusMessage`)
 * with a "Working..." fallback when the slot is empty.
 *
 * When `isFinishing` is true (the main response has completed and only
 * background `.work()` tasks are still settling on the open SSE stream),
 * renders a muted, non-shimmered "Tidying up..." label instead. This keeps
 * the user informed that the assistant is wrapping up without misleadingly
 * suggesting it is still producing their answer.
 */
export function StreamingIndicator({
  message,
  isFinishing = false,
}: {
  message?: string;
  isFinishing?: boolean;
}) {
  if (isFinishing) {
    return (
      <div
        data-testid="streaming-indicator"
        data-state="finishing"
        className="flex items-center gap-2 px-1 py-2 text-muted-foreground text-sm opacity-60"
      >
        <BrainIcon className="size-4" />
        <span>Tidying up...</span>
      </div>
    );
  }
  const label = message && message.length > 0 ? message : "Working...";
  return (
    <div data-testid="streaming-indicator" className="flex items-center gap-2 px-1 py-2 text-muted-foreground text-sm">
      <BrainIcon className="size-4" />
      <Shimmer duration={1}>{label}</Shimmer>
    </div>
  );
}
