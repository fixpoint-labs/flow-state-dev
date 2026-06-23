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

  return {
    onEvent: (event) => {
      store.recordSequence(event.sequence_number);
    },
    onRequestCreated: (event) => {
      store.setStatus(event.status);
      changed("status");
    },
    onRequestStatus: (event) => {
      store.setStatus(event.status);
      store.recordStatusEvent(event);
      changed("status");
    },
    onItemAdded: (event) => {
      if (!passes(event.item)) return;
      store.upsert(event.item);
      changed("item");
    },
    onItemDone: (event) => {
      if (!passes(event.item)) return;
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
      // Always buffer — a delta can arrive before its item.added (the buffered
      // delta is applied on the next flush once the item exists). But only
      // signal a flush when the item is already present: a delta for an unknown
      // or filtered-out item can't change the snapshot, so it must not schedule
      // a phantom flush. When the item.added lands, its onChange("item") covers
      // the buffered delta.
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
