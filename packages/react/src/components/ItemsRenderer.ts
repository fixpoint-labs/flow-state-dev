/**
 * Collection renderer for output item arrays.
 *
 * Items are rendered in the order provided — callers (useSession, etc.)
 * are responsible for sorting.
 */
import { createElement, type ReactNode } from "react";
import type { ComponentItem, OutputItem } from "@flow-state-dev/core/items";
import { ItemRenderer } from "./ItemRenderer";

/**
 * Props for rendering output item lists.
 */
export type ItemsRendererProps = {
  items: OutputItem[];
  /**
   * When true (default), component items that carry a stable `key` are
   * deduplicated: only the latest snapshot per key is rendered, replacing
   * earlier ones in-place. Set to false to render all snapshots.
   */
  deduplicateByKey?: boolean;
};

/**
 * For component items with a stable `key`, keep only the latest snapshot per key.
 * Items without a key are always included.
 */
function deduplicateComponentItems(items: OutputItem[]): OutputItem[] {
  const latestIndex = new Map<string, number>();
  items.forEach((item, i) => {
    const k = (item as ComponentItem).key;
    if (item.type === "component" && k !== undefined) {
      // Scope deduplication to the request: same key in different requests
      // are independent items (each request's plan is preserved).
      latestIndex.set(`${item.requestId}:${k}`, i);
    }
  });
  return items.filter((item, i) => {
    const k = (item as ComponentItem).key;
    if (item.type === "component" && k !== undefined) {
      return latestIndex.get(`${item.requestId}:${k}`) === i;
    }
    return true;
  });
}

/**
 * Renders output items in the order provided.
 *
 * Does not re-sort — useSession already sorts by timestamp with
 * itemIndex as tiebreaker.
 */
export function ItemsRenderer(props: ItemsRendererProps): ReactNode[] {
  const { deduplicateByKey = true } = props;
  const items = deduplicateByKey ? deduplicateComponentItems(props.items) : props.items;
  return items.map((item) =>
    createElement(ItemRenderer, { item, key: item.id })
  );
}
