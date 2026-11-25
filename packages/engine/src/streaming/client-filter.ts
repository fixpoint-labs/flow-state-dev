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
 * Stateful filter for a single SSE connection. Tracks suppressed item IDs so
 * that content events for non-client items are also suppressed, and
 * client-visible item IDs so that `item.updated` patches pass only for items
 * this connection has already forwarded.
 *
 * Updates fail closed: a patch carries no `type` (it is an identity-invariant
 * key), so an update for an item this connection never saw — a resumed stream
 * that starts past the item's `item.added`, or a legacy update keyed by `id`
 * whose value the emitter overwrote with the event id — is dropped. Every
 * client-visible update is followed by the item's `item.done`, which carries
 * the patched row, so a client that misses the patch still converges.
 *
 * A stream resumed past an item's `item.added` would not know to hide its
 * content, so a resuming route passes the request's stored items as
 * `knownItems`: the filter starts out knowing which of them it hides and
 * which it forwards, as if it had seen their `item.added`.
 *
 * @param knownItems Items the stream may carry events for without their
 *   `item.added`: the request record's items, on a resumed stream.
 */
export function createClientEventFilter(
  knownItems: readonly RuntimeItem[] = []
): (event: RequestStreamEvent) => boolean {
  const suppressedItemIds = new Set<string>();
  const clientItemIds = new Set<string>();
  for (const item of knownItems) {
    (resolveItemVisibility(item).client ? clientItemIds : suppressedItemIds).add(item.id);
  }

  return (event: RequestStreamEvent): boolean => {
    if (event.type === "item.added" || event.type === "item.done") {
      const item = (event as Record<string, unknown>).item as
        | Record<string, unknown>
        | undefined;
      if (item && !resolveItemVisibility(item as any).client) {
        suppressedItemIds.add(item.id as string);
        return false;
      }
      if (item) clientItemIds.add(item.id as string);
    }

    if (event.type === "item.updated") {
      // Forward only an update to an item seen as client-visible.
      const itemId = (event as Record<string, unknown>).itemId;
      return typeof itemId === "string" && clientItemIds.has(itemId);
    }

    if (
      (event.type === "content.added" ||
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
