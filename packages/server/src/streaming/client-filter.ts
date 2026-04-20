/**
 * SSE client-visibility filter — prevents non-client items from reaching the
 * SSE transport. Items flagged with `client: false` (explicitly or via type
 * defaults) are suppressed, along with their associated content events.
 *
 * The emitter still tracks all items for persistence and replay-from-store.
 * This filter only affects the live SSE connection to the end-user client.
 * Devtools bypasses this filter via the `?unfiltered=true` query parameter.
 */
import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import { resolveItemVisibility } from "@flow-state-dev/core/items";

/**
 * Stateful filter for a single SSE connection. Tracks suppressed item IDs
 * so that content events for non-client items are also suppressed.
 */
export function createClientEventFilter(): (event: RequestStreamEvent) => boolean {
  const suppressedItemIds = new Set<string>();

  return (event: RequestStreamEvent): boolean => {
    if (event.type === "item.added" || event.type === "item.done") {
      const item = (event as Record<string, unknown>).item as
        | Record<string, unknown>
        | undefined;
      if (item && !resolveItemVisibility(item as any).client) {
        suppressedItemIds.add(item.id as string);
        return false;
      }
    }

    if (
      (event.type === "content.added" ||
        event.type === "content.delta" ||
        event.type === "content.done") &&
      suppressedItemIds.has(
        (event as Record<string, unknown>).itemId as string
      )
    ) {
      return false;
    }

    return true;
  };
}

/**
 * Filters a batch of events, removing non-client items and their content.
 */
export function filterClientEvents(
  events: RequestStreamEvent[]
): RequestStreamEvent[] {
  const shouldForward = createClientEventFilter();
  return events.filter(shouldForward);
}
