/**
 * Adapter that turns a `RequestStreamStore` into a `RequestSSECallbacks` set —
 * the single deduplicated event→state reducer. Spread the result into
 * `createSSEClient` (GET-by-id) or `createSSEClientFromResponse` (inline POST
 * Response); each SSE callback mutates the store and signals `onChange(kind)`
 * so the consumer can flush a snapshot on its own schedule (RAF or immediate).
 *
 * The binder owns only the item/content/status reducer core. Consumer-specific
 * concerns (audio fan-out, resource/state buffering, watchdog, error UI) are
 * composed *over* the binder by the consumer that needs them. Note: the binder
 * does NOT auto-flush buffered content deltas — it accumulates and signals
 * `onChange("content")`; the consumer calls `store.flushDeltas()` in its flush
 * routine before reading `getSorted()`.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { RequestSSECallbacks } from "../types";
import type { RequestStreamStore } from "./request-stream-store";

/** What changed on the store, so a consumer can pick a flush policy per kind. */
export type RequestStreamChangeKind = "item" | "content" | "status";

/** Options for {@link bindStoreToCallbacks}. */
export type BindStoreToCallbacksOptions = {
  /** Invoked after a mutation that may have changed the snapshot. */
  onChange?: (kind: RequestStreamChangeKind) => void;
  /** Gate item upserts — items failing the predicate never reach the store. */
  itemFilter?: (item: OutputItem) => boolean;
};

/**
 * Build the deduplicated `RequestSSECallbacks` reducer for a store. Each
 * callback mutates the store, then signals `onChange` only when a mutation
 * actually occurred (so filtered-out items and dropped out-of-order updates do
 * not schedule spurious flushes).
 */
export function bindStoreToCallbacks(
  store: RequestStreamStore,
  options: BindStoreToCallbacksOptions = {}
): RequestSSECallbacks {
  const { onChange, itemFilter } = options;
  const changed = (kind: RequestStreamChangeKind): void => onChange?.(kind);
  const passes = (item: OutputItem): boolean => (itemFilter ? itemFilter(item) : true);

  // Ids of items the filter rejected. A rejected item never enters the store,
  // so its deltas can never be applied; we drop them on arrival rather than
  // buffer them. Bounded by the number of filtered items in the request.
  const rejected = new Set<string>();

  return {
    onEvent: (event) => {
      store.recordSequence(event.sequence_number);
    },
    onRequestCreated: (event) => {
      if (store.setStatus(event.status)) changed("status");
    },
    onRequestStatus: (event) => {
      // Record every status event (the log/resume cursor needs the full set),
      // but only signal a flush when the status value actually changed — a
      // fresh store's initial `request.created` and replayed duplicate status
      // frames are no-ops for consumers.
      const statusChanged = store.setStatus(event.status);
      store.recordStatusEvent(event);
      if (statusChanged) changed("status");
    },
    onItemAdded: (event) => {
      if (!passes(event.item)) {
        // Item rejected by the filter: remember it so later deltas are dropped
        // on arrival, and clear any deltas that already arrived for it before
        // this item.added so they don't sit buffered forever (the item will
        // never enter the store). Legitimate early deltas for items that simply
        // haven't arrived yet are left untouched.
        rejected.add(event.item.id);
        store.discardDeltas(event.item.id);
        return;
      }
      store.upsert(event.item);
      changed("item");
    },
    onItemDone: (event) => {
      if (!passes(event.item)) {
        // Same filter-seam cleanup as onItemAdded, in case item.done is the
        // first frame seen for a filtered item (no preceding item.added).
        rejected.add(event.item.id);
        store.discardDeltas(event.item.id);
        return;
      }
      store.upsert(event.item);
      changed("item");
    },
    onItemUpdated: (event) => {
      if (store.applyItemPatch(event.itemId, event.patch)) changed("item");
    },
    onContentAdded: (event) => {
      if (store.applyContentAdded(event.itemId, event.contentIndex, event.content)) {
        changed("content");
      }
    },
    onContentDelta: (event) => {
      // A delta for an item the filter already rejected can never be applied
      // (the item will never enter the store), so drop it instead of buffering
      // it forever — an aborted stream may never send the item.done that would
      // otherwise clean it up.
      if (rejected.has(event.itemId)) return;
      // Otherwise always buffer — a delta can arrive before its item.added (the
      // buffered delta is applied on the next flush once the item exists). But
      // only signal a flush when the item is already present: a delta for an
      // item that simply hasn't arrived yet can't change the snapshot, so it
      // must not schedule a phantom flush. When the item.added lands, its
      // onChange("item") covers the buffered delta.
      store.accumulateDelta(event.itemId, event.contentIndex, event.delta);
      if (store.getById(event.itemId) !== undefined) changed("content");
    },
    onContentDone: (event) => {
      if (store.applyContentDone(event.itemId, event.contentIndex, event.content)) {
        changed("content");
      }
    }
  };
}
