/**
 * Collection renderer for output item arrays.
 *
 * Items are rendered in the order provided — callers (useSession, etc.)
 * are responsible for sorting.
 */
import { createElement, type ReactNode } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { ItemRenderer } from "./ItemRenderer";

/**
 * Props for rendering output item lists.
 */
export type ItemsRendererProps = {
  items: OutputItem[];
};

/**
 * Renders output items in the order provided.
 *
 * Does not re-sort — useSession already sorts by timestamp with
 * itemIndex as tiebreaker.
 */
export function ItemsRenderer(props: ItemsRendererProps): ReactNode[] {
  return props.items.map((item) =>
    createElement(ItemRenderer, { item, key: item.id })
  );
}
