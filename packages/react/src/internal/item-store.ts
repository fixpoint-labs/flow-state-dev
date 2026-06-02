/**
 * Pure-data item store extracted from useSession. Manages a sorted item map,
 * ownership index, and content-delta queue without any React or transport
 * dependencies. The hook drives this store imperatively via a useRef.
 */
import type {
  Content,
  MessageItem,
  OutputItem,
  ReasoningItem
} from "@flow-state-dev/core/items";

/** Buffered text delta waiting to be flushed into an item's content. */
export type ContentDeltaAccumulator = {
  itemId: string;
  contentIndex: number;
  delta: string;
};

/**
 * Imperative sorted-item store. Maintains a Map<id, OutputItem> in sync with
 * a binary-insert-maintained sorted id list, an ownership index, and a
 * content-delta queue. All methods are synchronous; no React state is touched.
 */
export type ItemStore = {
  /** Replace all items with a pre-sorted snapshot. Rebuilds the ownership index. */
  loadSnapshot(items: OutputItem[]): void;
  /** Drop all items, sorted ids, ownership, and pending deltas. */
  clear(): void;
  /** Insert or update an item. Returns true if sorted order changed (insert or reorder), false if value-only update. */
  upsert(item: OutputItem): boolean;
  /** Remove an item from the map, sorted ids, and ownership index. Returns true if found. */
  deleteById(id: string): boolean;
  /** Buffer a text delta for later flush. */
  accumulateDelta(itemId: string, contentIndex: number, delta: string): void;
  /** Apply all buffered deltas to their target items and clear the queue. Returns true if any item changed. */
  flushDeltas(): boolean;
  /** Append a content part to an item. Returns true if the item was updated. */
  applyContentAdded(itemId: string, contentIndex: number, content: Content): boolean;
  /** Return all items in chronological order. New array each call. */
  getSorted(): OutputItem[];
  /** Look up a single item by id. */
  getById(id: string): OutputItem | undefined;
  /** Return items whose `ownedBy` matches the given value, sorted chronologically. */
  getOwnedBy(ownedBy: string): OutputItem[];
  /** Current item count. */
  size(): number;
};

/**
 * Compares two items for chronological ordering (ts ascending, itemIndex tiebreaker).
 */
export function compareItemOrder(a: OutputItem, b: OutputItem): number {
  const tsDiff = a.ts - b.ts;
  if (tsDiff !== 0) return tsDiff;
  return a.itemIndex - b.itemIndex;
}

/**
 * Insert an item into a sorted array, returning a new array. Uses an O(1)
 * tail fast-path (items nearly always arrive in order) with binary-search
 * fallback.
 */
export function insertSortedIntoArray(sorted: OutputItem[], item: OutputItem): OutputItem[] {
  const next = [...sorted];
  const len = next.length;

  if (len === 0) {
    next.push(item);
    return next;
  }

  if (compareItemOrder(item, next[len - 1]!) >= 0) {
    next.push(item);
    return next;
  }

  let lo = 0;
  let hi = len;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compareItemOrder(next[mid]!, item) < 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  next.splice(lo, 0, item);
  return next;
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

function updateItemWithContentAdded(
  target: OutputItem,
  _contentIndex: number,
  content: Content
): OutputItem {
  if (target.type === "message") {
    const message = target as MessageItem;
    const parts = [...(message.content ?? []), content];
    return { ...message, content: parts };
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

/** Create a new imperative item store. */
export function createItemStore(): ItemStore {
  let itemsById = new Map<string, OutputItem>();
  let sortedIds: string[] = [];
  let ownershipIndex = new Map<string, Set<string>>();
  const deltaQueue = new Map<string, ContentDeltaAccumulator>();

  const store: ItemStore = {
    loadSnapshot(items: OutputItem[]): void {
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
      itemsById = new Map();
      sortedIds = [];
      ownershipIndex = new Map();
      deltaQueue.clear();
    },

    upsert(item: OutputItem): boolean {
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
    },

    deleteById(id: string): boolean {
      const item = itemsById.get(id);
      if (item === undefined) return false;

      itemsById.delete(id);
      sortedIds = sortedIds.filter((sid) => sid !== id);

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
      for (const queued of deltaQueue.values()) {
        const target = itemsById.get(queued.itemId);
        if (target === undefined) continue;

        const nextItem = updateItemWithContentDelta(target, queued.contentIndex, queued.delta);
        if (nextItem !== target) {
          itemsById.set(queued.itemId, nextItem);
          hasChanges = true;
        }
      }

      deltaQueue.clear();
      return hasChanges;
    },

    applyContentAdded(itemId: string, contentIndex: number, content: Content): boolean {
      const existing = itemsById.get(itemId);
      if (existing === undefined) return false;

      const updated = updateItemWithContentAdded(existing, contentIndex, content);
      if (updated === existing) return false;

      itemsById.set(itemId, updated);
      return true;
    },

    getSorted(): OutputItem[] {
      return buildItemsFromMap(sortedIds, itemsById);
    },

    getById(id: string): OutputItem | undefined {
      return itemsById.get(id);
    },

    getOwnedBy(ownedBy: string): OutputItem[] {
      const ids = ownershipIndex.get(ownedBy);
      if (ids === undefined || ids.size === 0) return [];
      const result: OutputItem[] = [];
      for (const id of ids) {
        const item = itemsById.get(id);
        if (item !== undefined) result.push(item);
      }
      result.sort(compareItemOrder);
      return result;
    },

    size(): number {
      return itemsById.size;
    }
  };

  return store;
}
