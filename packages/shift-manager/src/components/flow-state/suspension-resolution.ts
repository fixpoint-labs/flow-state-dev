"use client";

import type { SuspensionResumeItem } from "@flow-state-dev/core/items";
import type { SuspensionStatus } from "@flow-state-dev/core/types";
import { useSessionItems } from "./session-items-context";

/**
 * Derive whether (and how) a suspension resolved from the live session item
 * stream (FIX-849). Shared by the polished suspension cards so each collapses to
 * a receipt on reload — the same `SessionItemsProvider` requirement as the
 * approval card. Returns the matching `suspension_resume`'s resolution, or
 * `{ isResolved: false }` while still pending.
 */
export function useSuspensionResolution(suspensionId: string): {
  isResolved: boolean;
  resolution: SuspensionStatus | undefined;
} {
  const sessionItems = useSessionItems();
  for (const it of sessionItems) {
    if (
      it.type === "suspension_resume" &&
      (it as SuspensionResumeItem).suspensionId === suspensionId
    ) {
      return { isResolved: true, resolution: (it as SuspensionResumeItem).resolution };
    }
  }
  return { isResolved: false, resolution: undefined };
}
