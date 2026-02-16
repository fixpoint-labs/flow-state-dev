/**
 * Collection renderer for ordered output item arrays.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import { ItemRenderer } from "./ItemRenderer";

/**
 * Props for rendering output item lists.
 */
export type ItemsRendererProps = {
  items: OutputItem[];
};

/**
 * Renders output items in deterministic `itemIndex` order.
 */
export function ItemsRenderer(props: ItemsRendererProps): unknown[] {
  return [...props.items]
    .sort((left, right) => left.itemIndex - right.itemIndex)
    .map((item) =>
      ItemRenderer({
        item
      })
    );
}
