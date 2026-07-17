/**
 * SSE client-visibility filter — prevents non-client items from reaching the
 * SSE transport. Items flagged with `client: false` (explicitly or via type
 * defaults) are suppressed, along with their associated `item.updated` and
 * content events.
 *
 * The emitter still tracks all items for persistence and replay-from-store.
 * This filter only affects the live SSE connection to the end-user client.
 * Devtools opts into trace items via the `?include=trace` query parameter.
 */
import type { OutputItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import { resolveItemVisibility } from "@flow-state-dev/core/items";

export type CreateClientEventFilterOptions = {
  /** Non-client item ids seen before the filter starts (e.g. SSE resume cursor). */
  suppressedItemIds?: Iterable<string>;
};

/**
 * Collects ids for items that must not reach the client SSE wire, from
 * persisted `item.added` / `item.done` events.
 */
export function collectSuppressedClientItemIdsFromEvents(
  events: Iterable<RequestStreamEvent>
): Set<string> {
  const suppressedItemIds = new Set<string>();
  for (const event of events) {
    if (event.type === "item.added" || event.type === "item.done") {
      const item = (event as { item?: OutputItem }).item;
      if (item !== undefined && !resolveItemVisibility(item).client) {
        suppressedItemIds.add(item.id);
      }
    }
  }
  return suppressedItemIds;
}

/**
 * Stateful filter for a single SSE connection. Tracks suppressed item IDs
 * so that follow-up item and content events for non-client items are suppressed.
 */
export function createClientEventFilter(
  options?: CreateClientEventFilterOptions
): (event: RequestStreamEvent) => boolean {
  const suppressedItemIds = new Set(options?.suppressedItemIds);

  return (event: RequestStreamEvent): boolean => {
    if (event.type === "item.added" || event.type === "item.done") {
      const item = (event as { item?: OutputItem }).item;
      if (item !== undefined && !resolveItemVisibility(item).client) {
        suppressedItemIds.add(item.id);
        return false;
      }
    }

    if (
      (event.type === "item.updated" ||
        event.type === "content.added" ||
        event.type === "content.delta" ||
        event.type === "content.audio.delta" ||
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

export type FilterClientEventsOptions = {
  /** Events at or before the resume cursor — seeds suppressed ids for reconnects. */
  seedEvents?: RequestStreamEvent[];
};

/**
 * Filters a batch of events, removing non-client items and their follow-ups.
 */
export function filterClientEvents(
  events: RequestStreamEvent[],
  options?: FilterClientEventsOptions
): RequestStreamEvent[] {
  const suppressedItemIds =
    options?.seedEvents !== undefined
      ? collectSuppressedClientItemIdsFromEvents(options.seedEvents)
      : undefined;
  const shouldForward = createClientEventFilter(
    suppressedItemIds !== undefined ? { suppressedItemIds } : undefined
  );
  return events.filter(shouldForward);
}
