/**
 * Small response-emitter helpers shared by the execution runtime.
 */
import type { RuntimeItem } from "@flow-state-dev/core/items/internal";

export type { RuntimeItem };

/**
 * Safely reads buffered response items from both public and internal emitters.
 */
export function getResponseItems(response: unknown): RuntimeItem[] {
  if (
    typeof response === "object" &&
    response !== null &&
    "getItems" in response &&
    typeof (response as { getItems?: unknown }).getItems === "function"
  ) {
    return (
      (response as { getItems: () => RuntimeItem[] }).getItems?.() ?? []
    );
  }

  return [];
}

/**
 * O(1) count of buffered response items, used to assign the next `itemIndex`.
 * Prefers the emitter's `getItemCount()` so this stays cheap on the emit hot
 * path; falls back to materializing items for partial mocks (FIX-406 6G).
 */
export function getResponseItemCount(response: unknown): number {
  if (
    typeof response === "object" &&
    response !== null &&
    "getItemCount" in response &&
    typeof (response as { getItemCount?: unknown }).getItemCount === "function"
  ) {
    return (response as { getItemCount: () => number }).getItemCount();
  }

  return getResponseItems(response).length;
}
