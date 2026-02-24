/**
 * Canonical item renderer — renders a single output item via the renderer registry.
 *
 * Resolution order for renderable types:
 * 1. Custom renderer from RendererRegistry (if registered via FlowProvider)
 *    — pass `false` to explicitly suppress a type
 * 2. Built-in fallback for message/status/error/step_error
 * 3. JSON `<pre>` for development visibility (all other unregistered types)
 *
 * Non-client types (context, state_change, resource_change) return null.
 *
 * All custom renderers receive `{ item }` as their prop.
 */
import { createElement, type ReactNode } from "react";
import type {
  ComponentItem,
  ContainerItem,
  ErrorItem,
  MessageItem,
  OutputItem,
  StatusItem,
  StepErrorItem
} from "@flow-state-dev/core/items";
import { useFlowContext } from "../context/FlowContext";
import { resolveRenderer } from "../registry/block-renderers";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Props for rendering one output item.
 */
export type ItemRendererProps = {
  item: OutputItem;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Item types that are never rendered on the client. */
const NON_RENDERABLE_TYPES = new Set([
  "context",
  "state_change",
  "resource_change"
]);

// ---------------------------------------------------------------------------
// Built-in fallback renderers for types that have sensible defaults.
// Used when no custom renderer is registered in the RendererRegistry.
// ---------------------------------------------------------------------------

function renderMessageFallback(item: MessageItem): ReactNode {
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

function renderStatusFallback(item: StatusItem): ReactNode {
  return createElement(
    "div",
    { "data-status": item.status },
    item.message
  );
}

function renderErrorFallback(item: ErrorItem): ReactNode {
  return createElement(
    "div",
    { "data-error": "true", style: { color: "red" } },
    item.message
  );
}

function renderStepErrorFallback(item: StepErrorItem): ReactNode {
  return createElement(
    "div",
    { "data-step-error": "true", style: { color: "orange" } },
    `${item.blockName ? `[${item.blockName}] ` : ""}${item.message}${item.recovered ? " (recovered)" : ""}`
  );
}

/** Map of item types to built-in fallback renderers. */
const BUILT_IN_FALLBACKS: Record<string, ((item: OutputItem) => ReactNode) | undefined> = {
  message: (item) => renderMessageFallback(item as MessageItem),
  status: (item) => renderStatusFallback(item as StatusItem),
  error: (item) => renderErrorFallback(item as ErrorItem),
  step_error: (item) => renderStepErrorFallback(item as StepErrorItem)
};

// ---------------------------------------------------------------------------
// ItemRenderer
// ---------------------------------------------------------------------------

/**
 * Renders one output item as a React node.
 *
 * Non-client types (context, state_change, resource_change) return null.
 * All other types resolve through the renderer registry, then built-in
 * fallbacks, then a JSON dev fallback.
 */
export function ItemRenderer(props: ItemRendererProps): ReactNode {
  const { item } = props;

  // Non-renderable types: bail early (no hooks called on this path).
  if (NON_RENDERABLE_TYPES.has(item.type)) {
    return null;
  }

  return renderItem(item);
}

/**
 * Internal rendering logic — separated so the non-renderable early-return
 * doesn't violate React's rules of hooks (hooks must be called
 * unconditionally within a component).
 */
function renderItem(item: OutputItem): ReactNode {
  const { renderers } = useFlowContext();

  const componentKey =
    item.type === "component"
      ? (item as ComponentItem).component
      : item.type === "container"
        ? (item as ContainerItem).component
        : undefined;

  const resolved = resolveRenderer(renderers, item.type, componentKey);

  // Explicitly suppressed — `false` means "don't render this type."
  if (resolved === false) {
    return null;
  }

  // 1. Custom renderer from registry.
  if (resolved !== undefined) {
    return createElement(resolved, { item });
  }

  // 2. Built-in fallback (message, status, error, step_error).
  const fallback = BUILT_IN_FALLBACKS[item.type];
  if (fallback !== undefined) {
    return fallback(item);
  }

  // 3. JSON dev fallback for unregistered types.
  return createElement(
    "pre",
    { style: { fontSize: 12 } },
    JSON.stringify(
      {
        type: item.type,
        ...(componentKey !== undefined ? { component: componentKey } : {}),
        status: item.status
      },
      null,
      2
    )
  );
}
