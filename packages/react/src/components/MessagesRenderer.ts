/**
 * Message-focused renderer for filtering and rendering `message` output items.
 */
import type { MessageItem, OutputItem } from "@flow-state-dev/core/items";
import { ItemRenderer } from "./ItemRenderer";

/**
 * Props for rendering only message items.
 */
export type MessagesRendererProps = {
  items: OutputItem[];
};

/**
 * Renders only message items while preserving stream order.
 */
export function MessagesRenderer(props: MessagesRendererProps): unknown[] {
  return props.items
    .filter((item): item is MessageItem => item.type === "message")
    .sort((left, right) => left.itemIndex - right.itemIndex)
    .map((item) =>
      ItemRenderer({
        item
      })
    );
}
