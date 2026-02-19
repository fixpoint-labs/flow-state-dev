/**
 * Canonical item renderer entrypoint for single stream items.
 */
import { createElement, type ReactNode } from "react";
import type {
  MessageItem,
  OutputItem,
  StatusItem
} from "@flow-state-dev/core/items";
import { BlockRenderer } from "./BlockRenderer";

/**
 * Props for rendering one output item.
 */
export type ItemRendererProps = {
  item: OutputItem;
};

/**
 * Renders one output item as a React node.
 */
export function ItemRenderer(props: ItemRendererProps): ReactNode {
  if (props.item.type === "fsd:block_output") {
    return BlockRenderer({
      item: props.item
    });
  }

  if (props.item.type === "message") {
    return renderMessageItem(props.item);
  }

  if (props.item.type === "fsd:status") {
    return renderStatusItem(props.item);
  }

  return createElement(
    "pre",
    { style: { fontSize: 12 } },
    JSON.stringify({ type: props.item.type, status: props.item.status }, null, 2)
  );
}

function renderMessageItem(item: MessageItem): ReactNode {
  const text = item.content
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("\n");

  return createElement(
    "div",
    { "data-role": item.role },
    createElement("strong", null, item.role === "user" ? "You" : "Assistant"),
    createElement("p", { style: { margin: "4px 0" } }, text)
  );
}

function renderStatusItem(item: StatusItem): ReactNode {
  return createElement(
    "div",
    { "data-status": item.status },
    item.message ?? item.status
  );
}
