/**
 * Canonical item renderer entrypoint for single stream items.
 *
 * Dispatches to type-specific renderers or the BlockRenderer for
 * items that participate in the renderer registry.
 */
import { createElement, type ReactNode } from "react";
import type {
  MessageItem,
  OutputItem,
  StatusItem,
  ErrorItem,
  StepErrorItem
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
 *
 * Items with registered renderers (`block_output`, `component`, `container`)
 * route through BlockRenderer which reads from FlowProvider context.
 * Built-in types (`message`, `status`, `error`, `step_error`) use inline renderers.
 * Non-client types (`context`, `state_change`, `resource_change`) return null.
 */
export function ItemRenderer(props: ItemRendererProps): ReactNode {
  const { item } = props;

  // Registry-resolved types.
  if (
    item.type === "block_output" ||
    item.type === "component" ||
    item.type === "container"
  ) {
    return BlockRenderer({ item });
  }

  // Built-in renderers.
  if (item.type === "message") {
    return renderMessageItem(item);
  }

  if (item.type === "reasoning") {
    // Reasoning items can be rendered via registry or inline.
    return BlockRenderer({ item });
  }

  if (item.type === "status") {
    return renderStatusItem(item);
  }

  if (item.type === "error") {
    return renderErrorItem(item);
  }

  if (item.type === "step_error") {
    return renderStepErrorItem(item);
  }

  // Non-client types (context, state_change, resource_change): not rendered.
  return null;
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
    item.message
  );
}

function renderErrorItem(item: ErrorItem): ReactNode {
  return createElement(
    "div",
    { "data-error": "true", style: { color: "red" } },
    item.message
  );
}

function renderStepErrorItem(item: StepErrorItem): ReactNode {
  return createElement(
    "div",
    { "data-step-error": "true", style: { color: "orange" } },
    `${item.blockName ? `[${item.blockName}] ` : ""}${item.message}${item.recovered ? " (recovered)" : ""}`
  );
}
