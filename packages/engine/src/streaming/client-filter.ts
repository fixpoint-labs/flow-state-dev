/**
 * SSE client-visibility filter — prevents non-client items from reaching the
 * SSE transport. Items flagged with `client: false` (explicitly or via type
 * defaults) are suppressed, along with their associated content events and
 * `item.updated` patches.
 *
 * The emitter still tracks all items for persistence and replay-from-store.
 * This filter only affects the live SSE connection to the end-user client.
 * Devtools opts into trace items via the `?include=trace` query parameter,
 * honoured only while trace observability is on (`traceRequestAllowed`).
 */
import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import { resolveItemVisibility } from "@flow-state-dev/core/items";
import type { RuntimeItem } from "@flow-state-dev/core/internal";

/**
 * Stateful filter for a single SSE connection. An item's `item.added` and
 * `item.done` carry its type and visibility, so they are forwarded or dropped
 * on their own. Every other event about an item (`item.updated` patches and
 * content events) carries only the item's id, so it is forwarded only for an
 * item this filter knows to be client-visible.
 *
 * The rule fails closed: an event for an item the filter does not know is
 * dropped. A stream resumed past an item's `item.added` would otherwise
 * forward a hidden item's content, so a resuming route passes the request's
 * stored items as `knownItems`, and the filter starts out knowing the visible
 * ones as if it had seen their `item.added`. An item the store did not yet
 * hold misses its patches and content on that stream; its `item.done`
 * carries the whole row, so the client still converges.
 *
 * @param knownItems Items the stream may carry events for without their
 *   `item.added`: the request record's items, on a resumed stream.
 */
export function createClientEventFilter(
  knownItems: readonly RuntimeItem[] = []
): (event: RequestStreamEvent) => boolean {
  const clientItemIds = new Set<string>(
    knownItems.filter((item) => resolveItemVisibility(item).client).map((item) => item.id)
  );

  return (event: RequestStreamEvent): boolean => {
    if (event.type === "item.added" || event.type === "item.done") {
      const item = event.item as RuntimeItem;
      if (!resolveItemVisibility(item).client) return false;
      clientItemIds.add(item.id);
      return true;
    }

    if (
      event.type === "item.updated" ||
      event.type === "content.added" ||
      event.type === "content.delta" ||
      event.type === "content.audio.delta" ||
      event.type === "content.done"
    ) {
      return clientItemIds.has(event.itemId);
    }

    return true;
  };
}

/**
 * Filters a batch of events, removing non-client items and their content.
 *
 * @param knownItems As for {@link createClientEventFilter}.
 */
export function filterClientEvents(
  events: RequestStreamEvent[],
  knownItems: readonly RuntimeItem[] = []
): RequestStreamEvent[] {
  const shouldForward = createClientEventFilter(knownItems);
  return events.filter(shouldForward);
}
