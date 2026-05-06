/**
 * Small response-emitter helpers shared by the execution runtime.
 */
import type {
  BlockDebugItem,
  BlockOutputItem,
  OutputItem,
  RouterDecisionItem,
  StateSnapshotItem
} from "@flow-state-dev/core/items";

/**
 * Server-side item union. The public `OutputItem` excludes trace items;
 * runtime buffers carry them, so this alias re-includes the four trace
 * types for internal narrowing.
 */
export type RuntimeItem =
  | OutputItem
  | BlockOutputItem
  | RouterDecisionItem
  | StateSnapshotItem
  | BlockDebugItem;

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
