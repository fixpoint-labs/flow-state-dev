/**
 * Shared request-stream accumulator. Turns the SSE event stream for a single
 * request into a sorted, canonical item view plus the request's status,
 * sequence cursor, and status-event log — without any React or transport
 * dependencies. Consumers (the react `useRequestStream`/`useSession` hooks and
 * the DevTool stream hook) drive this store imperatively, typically via the
 * `bindStoreToCallbacks` adapter, and read snapshots through `getSorted()`.
 *
 * This is the one deduplicated reducer: it was promoted out of
 * `@flow-state-dev/react`'s internal `ItemStore` (the most complete of the
 * three former reducers) and extended with the status/sequence/status-event
 * bookkeeping the hook wrappers used to hand-roll.
 */
import {
  collapseToCanonicalLog,
  ITEM_UPDATE_INVARIANT_KEYS
} from "@flow-state-dev/contracts/items";
import { deepEqual } from "@flow-state-dev/core/helpers";
import type {
  Content,
  MessageItem,
  OutputItem,
  ReasoningItem,
  RequestStatus,
  RequestStatusEvent
} from "@flow-state-dev/core/items";

/** Buffered text delta waiting to be flushed into an item's content. */
export type ContentDeltaAccumulator = {
  itemId: string;
  contentIndex: number;
  delta: string;
};

/**
 * Imperative request-stream store. Maintains a `Map<id, OutputItem>` in sync
 * with a binary-insert-maintained sorted id list, an ownership index, and a
 * content-delta queue, plus the request's status, sequence cursor, and
 * status-event log. All methods are synchronous; no React state is touched.
 */
export type RequestStreamStore = {
  /** Replace all items with a pre-sorted snapshot. Rebuilds the ownership index. Leaves status/sequence/status-events untouched. */
  loadSnapshot(items: OutputItem[]): void;
  /** Drop all items, sorted ids, ownership, pending deltas, and reset the status/sequence/status-event layer to a fresh stream. */
  clear(): void;
  /** Insert or update an item. Returns true if sorted order changed (insert or reorder), false if value-only update. */
  upsert(item: OutputItem): boolean;
  /** Apply a shallow `item.updated` patch (invariant keys stripped) to an existing item. Returns false (no-op) if the id is unknown. */
  applyItemPatch(itemId: string, patch: Record<string, unknown>): boolean;
  /** Remove an item from the map, sorted ids, and ownership index. Returns true if found. */
  deleteById(id: string): boolean;
  /** Buffer a text delta for later flush. */
  accumulateDelta(itemId: string, contentIndex: number, delta: string): void;
  /** Apply every buffered delta whose target item and content part are ready; deltas that aren't ready yet stay queued for a later flush (streamed text is never dropped). Returns true if any item changed. */
  flushDeltas(): boolean;
  /** Discard all buffered deltas for an item — the binder's filter seam calls this when `itemFilter` rejects an item, so a permanently-absent item's deltas don't sit in the queue. No-op if none are buffered. */
  discardDeltas(itemId: string): void;
  /** Place a content part at an index on a message (`content`) or reasoning (`summary`) item — overwrites an existing index, otherwise appends. Returns true if the item was updated. */
  applyContentAdded(itemId: string, contentIndex: number, content: Content): boolean;
  /** Replace a content part with its authoritative final value at an index (inserting if no prior part exists). Returns true if the item was updated. */
  applyContentDone(itemId: string, contentIndex: number, content: Content): boolean;
  /** Return all items in canonical (collapsed) chronological order. New array each call. */
  getSorted(): OutputItem[];
  /**
   * Return all items in chronological order WITHOUT the canonical collapse —
   * every superseded partial/in-progress row `getSorted()` strips (Rule 3,
   * crash-recovery re-run) is still present here. Consumers that need to
   * render the pre-/post-recovery boundary itself (rather than just the
   * merged live view) read this instead of `getSorted()`. New array each call.
   */
  getRaw(): OutputItem[];
  /** Look up a single item by id. */
  getById(id: string): OutputItem | undefined;
  /** Return items whose `ownedBy` matches the given value, sorted chronologically. */
  getOwnedBy(ownedBy: string): OutputItem[];
  /** Current item count. */
  size(): number;
  /** The request's current status (default `"in_progress"`). */
  readonly status: RequestStatus;
  /** Set the request status (from a `request.created` / `request.*` event). Returns true if the value changed. */
  setStatus(status: RequestStatus): boolean;
  /** The highest sequence number recorded from the stream (the resume cursor). */
  readonly lastSequenceNumber: number;
  /** Record a stream event's sequence number, advancing the resume cursor. */
  recordSequence(sequenceNumber: number): void;
  /** Every `request.*` status event seen, in arrival order. */
  readonly statusEvents: readonly RequestStatusEvent[];
  /** Append a `request.*` status event to the log. */
  recordStatusEvent(event: RequestStatusEvent): void;
};

/**
 * Compares two items for chronological ordering (ts ascending, itemIndex tiebreaker).
 */
export function compareItemOrder(a: OutputItem, b: OutputItem): number {
  const tsDiff = a.ts - b.ts;
  if (tsDiff !== 0) return tsDiff;
  return a.itemIndex - b.itemIndex;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function updateItemWithContentDelta(
  target: OutputItem,
  contentIndex: number,
  delta: string
): OutputItem {
  if (target.type === "message") {
    const message = target as MessageItem;
    const content = [...(message.content ?? [])];
    const part = content[contentIndex];
    if (part !== undefined && part.type === "output_text") {
      content[contentIndex] = {
        ...part,
        text: (part.text ?? "") + delta
      };
      return { ...message, content };
    }
  }

  if (target.type === "reasoning") {
    const reasoning = target as ReasoningItem;
    const summary = [...(reasoning.summary ?? [])];
    const part = summary[contentIndex];
    if (part !== undefined && part.type === "reasoning_text") {
      summary[contentIndex] = {
        ...part,
        text: (part.text ?? "") + delta
      };
      return { ...reasoning, summary };
    }
  }

  return target;
}

/**
 * Overwrite the part at `index` if it exists, otherwise append. Returns a new
 * array. Assumes contiguous indices (the producer emits content parts in
 * order): a gap (`index > length`) appends rather than preserving the slot, so
 * callers must not skip indices. Production emits index 0 against a length-1
 * array, so the overwrite path is the live case.
 */
function placeContentAt(parts: Content[], index: number, content: Content): Content[] {
  const next = [...parts];
  if (index >= 0 && index < next.length) {
    next[index] = content;
  } else {
    next.push(content);
  }
  return next;
}

/**
 * Place a `content.added` / `content.done` part on a message (`content`) or
 * reasoning (`summary`) item. Both events resolve to the same array placement:
 * overwrite the existing slot at `contentIndex`, otherwise append. Returns the
 * target unchanged for item kinds that carry no content array.
 *
 * Note: overwriting at `contentIndex` is intentional and unifies with the
 * DevTool reducer. It differs from the former react `ItemStore`, which ignored
 * the index and always appended — that double-appended onto the generator's
 * pre-seeded length-1 content array, leaving a stray empty part. Overwriting is
 * the corrected behavior.
 */
function updateItemWithContent(
  target: OutputItem,
  contentIndex: number,
  content: Content
): OutputItem {
  if (target.type === "message") {
    const message = target as MessageItem;
    return { ...message, content: placeContentAt(message.content ?? [], contentIndex, content) };
  }

  if (target.type === "reasoning") {
    const reasoning = target as ReasoningItem;
    return { ...reasoning, summary: placeContentAt(reasoning.summary ?? [], contentIndex, content) };
  }

  return target;
}

function sameChronologicalOrder(left: OutputItem, right: OutputItem): boolean {
  return left.ts === right.ts && left.itemIndex === right.itemIndex;
}

function insertSortedItemId(
  sortedIds: string[],
  newItem: OutputItem,
  itemsById: ReadonlyMap<string, OutputItem>
): string[] {
  const next = [...sortedIds];
  const len = next.length;

  if (len === 0) {
    next.push(newItem.id);
    return next;
  }

  const lastItem = itemsById.get(next[len - 1]!);
  if (lastItem !== undefined && compareItemOrder(newItem, lastItem) >= 0) {
    next.push(newItem.id);
    return next;
  }

  let lo = 0;
  let hi = len;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const midItem = itemsById.get(next[mid]!);
    if (midItem !== undefined && compareItemOrder(midItem, newItem) < 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  next.splice(lo, 0, newItem.id);
  return next;
}

function buildItemsFromMap(
  ids: string[],
  itemsById: ReadonlyMap<string, OutputItem>
): OutputItem[] {
  const next: OutputItem[] = [];
  for (const id of ids) {
    const item = itemsById.get(id);
    if (item !== undefined) {
      next.push(item);
    }
  }
  return next;
}

function trackOwnership(
  ownershipIndex: Map<string, Set<string>>,
  item: OutputItem
): void {
  const ownedBy = (item as OutputItem & { ownedBy?: string }).ownedBy;
  if (ownedBy === undefined) return;
  let set = ownershipIndex.get(ownedBy);
  if (set === undefined) {
    set = new Set();
    ownershipIndex.set(ownedBy, set);
  }
  set.add(item.id);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a new imperative request-stream store. */
export function createRequestStreamStore(): RequestStreamStore {
  let itemsById = new Map<string, OutputItem>();
  let sortedIds: string[] = [];
  let ownershipIndex = new Map<string, Set<string>>();
  const deltaQueue = new Map<string, ContentDeltaAccumulator>();

  // Protocol-state layer (folded from the former hook wrappers).
  let status: RequestStatus = "in_progress";
  let lastSequenceNumber = 0;
  let statusEvents: RequestStatusEvent[] = [];

  // Memoized canonical view (FIX-811). The collapse is O(n); caching it keeps
  // `getSorted` and `getOwnedBy` from rebuilding+rescanning the whole log on
  // every call (a React render can call `getOwnedBy` once per displayed block).
  // Invalidated (set to null) by every mutation below; recomputed lazily.
  let canonicalCache: OutputItem[] | null = null;
  const invalidateCanonical = (): void => {
    canonicalCache = null;
  };
  const canonical = (): OutputItem[] => {
    if (canonicalCache === null) {
      canonicalCache = collapseToCanonicalLog(buildItemsFromMap(sortedIds, itemsById));
    }
    return canonicalCache;
  };

  // Insert or update an item, maintaining the sorted-id list and ownership
  // index. Shared by `upsert` and `applyItemPatch` so a patch that changes a
  // sort key (ts/itemIndex) or `ownedBy` re-sorts and re-indexes instead of
  // leaving those indexes stale. Returns true if sorted order changed.
  const upsertItem = (item: OutputItem): boolean => {
    const existing = itemsById.get(item.id);
    const isNew = existing === undefined;
    const orderChanged = existing !== undefined && !sameChronologicalOrder(existing, item);

    // Clean up stale ownership when ownedBy changes on an existing item.
    if (existing !== undefined) {
      const oldOwner = (existing as OutputItem & { ownedBy?: string }).ownedBy;
      const newOwner = (item as OutputItem & { ownedBy?: string }).ownedBy;
      if (oldOwner !== undefined && oldOwner !== newOwner) {
        const set = ownershipIndex.get(oldOwner);
        if (set !== undefined) {
          set.delete(item.id);
          if (set.size === 0) ownershipIndex.delete(oldOwner);
        }
      }
    }

    itemsById.set(item.id, item);
    trackOwnership(ownershipIndex, item);
    invalidateCanonical();

    if (isNew) {
      sortedIds = insertSortedItemId(sortedIds, item, itemsById);
      return true;
    }

    if (orderChanged) {
      sortedIds = insertSortedItemId(
        sortedIds.filter((id) => id !== item.id),
        item,
        itemsById
      );
      return true;
    }

    return false;
  };

  const store: RequestStreamStore = {
    loadSnapshot(items: OutputItem[]): void {
      invalidateCanonical();
      itemsById = new Map<string, OutputItem>();
      sortedIds = [];
      ownershipIndex = new Map<string, Set<string>>();
      deltaQueue.clear();

      for (const item of items) {
        itemsById.set(item.id, item);
        sortedIds.push(item.id);
        trackOwnership(ownershipIndex, item);
      }
    },

    clear(): void {
      invalidateCanonical();
      itemsById = new Map();
      sortedIds = [];
      ownershipIndex = new Map();
      deltaQueue.clear();
      status = "in_progress";
      lastSequenceNumber = 0;
      statusEvents = [];
    },

    upsert(item: OutputItem): boolean {
      return upsertItem(item);
    },

    applyItemPatch(itemId: string, patch: Record<string, unknown>): boolean {
      const existing = itemsById.get(itemId);
      if (existing === undefined) return false;

      const sanitized: Record<string, unknown> = {};
      for (const key of Object.keys(patch)) {
        if ((ITEM_UPDATE_INVARIANT_KEYS as ReadonlyArray<string>).includes(key)) continue;
        sanitized[key] = patch[key];
      }

      // A patch that was entirely invariant keys changes nothing — report no-op
      // so the binder doesn't signal a phantom flush.
      if (Object.keys(sanitized).length === 0) return false;

      const existingRecord = existing as Record<string, unknown>;
      const isNoOp = Object.keys(sanitized).every((key) =>
        deepEqual(existingRecord[key], sanitized[key])
      );
      if (isNoOp) return false;

      // Route through upsertItem so a patch touching a sort key (ts/itemIndex)
      // or `ownedBy` re-sorts and re-indexes ownership rather than leaving the
      // sorted-id / ownership indexes stale.
      upsertItem({ ...existing, ...sanitized } as OutputItem);
      return true;
    },

    deleteById(id: string): boolean {
      const item = itemsById.get(id);
      if (item === undefined) return false;

      itemsById.delete(id);
      sortedIds = sortedIds.filter((sid) => sid !== id);
      invalidateCanonical();

      const ownedBy = (item as OutputItem & { ownedBy?: string }).ownedBy;
      if (ownedBy !== undefined) {
        const set = ownershipIndex.get(ownedBy);
        if (set !== undefined) {
          set.delete(id);
          if (set.size === 0) ownershipIndex.delete(ownedBy);
        }
      }

      return true;
    },

    accumulateDelta(itemId: string, contentIndex: number, delta: string): void {
      const key = `${itemId}:${contentIndex}`;
      const existing = deltaQueue.get(key);
      if (existing === undefined) {
        deltaQueue.set(key, { itemId, contentIndex, delta });
      } else {
        existing.delta += delta;
      }
    },

    flushDeltas(): boolean {
      if (deltaQueue.size === 0) return false;

      let hasChanges = false;
      // Apply each buffered delta to its target, keeping a delta queued whenever
      // it can't be applied yet so streamed text is never dropped:
      //  - item not present yet — a delta can arrive before its `item.added`
      //    (out-of-order delivery / resume race); applied on a later flush once
      //    the item exists.
      //  - item present but the target content part isn't ready (item.added
      //    arrived with an empty content array before content.added created the
      //    slot) — applied on a later flush.
      // This method can't tell a not-yet-arrived item from one the binder's
      // `itemFilter` permanently rejected, so it never drops on an absent item;
      // the binder clears a rejected item's deltas at its filter seam via
      // `discardDeltas`. (Deleting the current entry mid-iteration is safe for
      // Map.) A delta superseded by content.done is removed in applyContentDone.
      for (const [key, queued] of deltaQueue) {
        const target = itemsById.get(queued.itemId);
        if (target === undefined) continue; // item not present yet — keep buffered

        const nextItem = updateItemWithContentDelta(target, queued.contentIndex, queued.delta);
        if (nextItem === target) continue; // target content part not ready — keep buffered

        itemsById.set(queued.itemId, nextItem);
        deltaQueue.delete(key);
        hasChanges = true;
      }

      if (hasChanges) invalidateCanonical();
      return hasChanges;
    },

    discardDeltas(itemId: string): void {
      // Targeted cleanup for an item the binder's `itemFilter` rejected: its
      // deltas were buffered by `accumulateDelta` (which runs before the item is
      // known) but the item will never enter the store, so flushDeltas would
      // keep them forever. Drop only this item's deltas, leaving legitimate
      // early deltas for not-yet-arrived items untouched.
      for (const [key, queued] of deltaQueue) {
        if (queued.itemId === itemId) deltaQueue.delete(key);
      }
    },

    applyContentAdded(itemId: string, contentIndex: number, content: Content): boolean {
      const existing = itemsById.get(itemId);
      if (existing === undefined) return false;

      const updated = updateItemWithContent(existing, contentIndex, content);
      if (updated === existing) return false;

      itemsById.set(itemId, updated);
      invalidateCanonical();
      return true;
    },

    applyContentDone(itemId: string, contentIndex: number, content: Content): boolean {
      const existing = itemsById.get(itemId);
      if (existing === undefined) return false;

      // The authoritative `content.done` part supersedes any deltas still
      // buffered for this slot. Drop them so a later `flushDeltas()` (e.g. a
      // RAF-batched flush where the deltas and the done landed in the same
      // frame) cannot append stale text on top of the final content.
      deltaQueue.delete(`${itemId}:${contentIndex}`);

      const updated = updateItemWithContent(existing, contentIndex, content);
      if (updated === existing) return false;

      itemsById.set(itemId, updated);
      invalidateCanonical();
      return true;
    },

    getSorted(): OutputItem[] {
      // Memoized canonical view (FIX-811): once a resume's `suspension_resume`
      // arrives on the stream, the suspending block's superseded run-1
      // emissions are dropped so the live view shows each emission once. A no-op
      // until a suspension is resolved. The collapse (the O(n) scan) is cached
      // until the next mutation; we return a fresh copy so the documented
      // "new array each call" contract holds and no caller can mutate the cache.
      return [...canonical()];
    },

    getRaw(): OutputItem[] {
      return buildItemsFromMap(sortedIds, itemsById);
    },

    getById(id: string): OutputItem | undefined {
      return itemsById.get(id);
    },

    getOwnedBy(ownedBy: string): OutputItem[] {
      const ids = ownershipIndex.get(ownedBy);
      if (ids === undefined || ids.size === 0) return [];
      // Filter the memoized CANONICAL list (FIX-811) so a resumed block's
      // superseded run-1 emissions don't surface here while `getSorted()` shows
      // each emission once — `getOwnedItems` must stay consistent with `items`.
      // Reuses the same cache as `getSorted`, so this no longer recomputes the
      // collapse per call.
      return canonical().filter(
        (item) => (item as OutputItem & { ownedBy?: string }).ownedBy === ownedBy
      );
    },

    size(): number {
      return itemsById.size;
    },

    get status(): RequestStatus {
      return status;
    },

    setStatus(next: RequestStatus): boolean {
      if (status === next) return false;
      status = next;
      return true;
    },

    get lastSequenceNumber(): number {
      return lastSequenceNumber;
    },

    recordSequence(sequenceNumber: number): void {
      // High-water mark: never let the resume cursor move backward if a
      // replayed or out-of-order event arrives after a newer one.
      lastSequenceNumber = Math.max(lastSequenceNumber, sequenceNumber);
    },

    get statusEvents(): readonly RequestStatusEvent[] {
      // Fresh array of cloned events so a caller can't mutate internal state
      // through the returned array or its event objects, or see it change
      // underfoot. Events are tiny flat objects, so the per-read clone is cheap.
      return statusEvents.map((event) => ({ ...event }));
    },

    recordStatusEvent(event: RequestStatusEvent): void {
      // Store a shallow copy so a later mutation of the caller's event object
      // can't reach back into the log.
      statusEvents.push({ ...event });
    }
  };

  return store;
}
