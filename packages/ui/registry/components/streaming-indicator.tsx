"use client";

import { BrainIcon } from "lucide-react";
import { Shimmer } from "./shimmer";

/**
 * Shown while streaming is active but no assistant content has arrived yet.
 * Gives immediate visual feedback that the system is working.
 */
export function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 px-1 py-2 text-muted-foreground text-sm">
      <BrainIcon className="size-4" />
      <Shimmer duration={1}>Thinking...</Shimmer>
    </div>
  );
}
