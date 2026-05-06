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
