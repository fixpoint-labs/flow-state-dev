"use client";

import { BrainIcon } from "lucide-react";
import { Shimmer } from "./shimmer";

/**
 * Single-line in-flight status indicator. Renders the latest value from the
 * request-scoped status slot (via `ctx.emitStatus()` / `activeStatusMessage`)
 * with a "Thinking..." fallback when the slot is empty.
 */
export function StreamingIndicator({ message }: { message?: string }) {
  const label = message && message.length > 0 ? message : "Thinking...";
  return (
    <div data-testid="streaming-indicator" className="flex items-center gap-2 px-1 py-2 text-muted-foreground text-sm">
      <BrainIcon className="size-4" />
      <Shimmer duration={1}>{label}</Shimmer>
    </div>
  );
}
