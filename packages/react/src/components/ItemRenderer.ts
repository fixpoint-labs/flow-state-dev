/**
 * Canonical item renderer entrypoint for single stream items.
 */
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
 * Renders one output item into a framework-agnostic render payload.
 */
export function ItemRenderer(props: ItemRendererProps): unknown {
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

  return {
    type: props.item.type,
    status: props.item.status,
    visibility: props.item.visibility,
    item: props.item
  };
}

function renderMessageItem(item: MessageItem): unknown {
  const text = item.content
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("\n");

  return {
    type: "message",
    role: item.role,
    text,
    item
  };
}

function renderStatusItem(item: StatusItem): unknown {
  return {
    type: "status",
    message: item.message,
    detail: item.detail,
    item
  };
}
