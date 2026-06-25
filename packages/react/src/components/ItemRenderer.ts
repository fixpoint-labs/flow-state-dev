/**
 * Canonical item renderer — renders a single output item via the renderer registry.
 *
 * Resolution order for renderable types:
 * 1. Custom renderer from RendererRegistry (if registered via FlowProvider)
 *    — pass `false` to explicitly suppress a type
 * 2. Built-in fallback for message/status/error
 * 3. JSON `<pre>` for development visibility (all other unregistered types)
 *
 * Non-client types (context, state_change, resource_change) return null.
 *
 * All custom renderers receive `{ item }` as their prop.
 */
import { createElement, type ReactNode } from "react";
import type {
  ToolOutputItem,
  ComponentItem,
  ContainerItem,
  ErrorItem,
  MessageItem,
  OutputItem,
  ReasoningItem,
  StatusItem,
  SuspensionItem
} from "@flow-state-dev/core/items";
import type { SuspensionStatus } from "@flow-state-dev/core/types";
import { useFlowContext } from "../context/FlowContext";
import { resolveRenderer, type BlockComponentType, type RendererRegistry } from "../registry/block-renderers";
import { ApprovalRenderer } from "./ApprovalRenderer";
import { QuestionRenderer } from "./QuestionRenderer";
import { SelectionRenderer } from "./SelectionRenderer";
import { SchemaFormRenderer } from "./SchemaFormRenderer";
import { suspensionShape } from "../hooks/useSuspensionForm";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Props for rendering one output item.
 */
export type ItemRendererProps = {
  item: OutputItem;
  /**
   * For a `suspension` item rendered inline via the built-in ApprovalRenderer
   * fallback: whether a matching `suspension_resume` item has already arrived.
   * ItemsRenderer computes this from the full item list; when true the default
   * card collapses to a receipt. Ignored for non-suspension items and for custom
   * or suppressed renderers.
   */
  isResolved?: boolean;
  /**
   * For a resolved `suspension` item: how it was resolved (from the matching
   * `suspension_resume` item), so the collapsed receipt shows the real outcome.
   * Ignored for non-suspension items.
   */
  resolution?: SuspensionStatus;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Item types that are never rendered on the client. */
const NON_RENDERABLE_TYPES = new Set([
  "state_change",
  "resource_change",
  // Audit record of a resolved suspension (FIX-811). Client-visible for the
  // log, but apps render their resume UI off the `suspension` item, not this.
  "suspension_resume"
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

function renderReasoningFallback(item: ReasoningItem): ReactNode {
  const text = item.summary
    .filter((c) => c.type === "reasoning_text")
    .map((c) => c.text)
    .join("\n");

  return createElement(
    "details",
    { "data-reasoning": "true", style: { margin: "4px 8px", opacity: 0.7 } },
    createElement("summary", { style: { cursor: "pointer", fontSize: 13 } }, "Reasoning"),
    createElement("pre", { style: { fontSize: 12, whiteSpace: "pre-wrap", margin: "4px 0" } }, text)
  );
}

function renderBlockToolOutputFallback(item: ToolOutputItem): ReactNode {
  const statusLabel = item.status === "in_progress" ? "Running" : item.status === "failed" ? "Error" : "Completed";

  let parsedArgs: string;
  try {
    parsedArgs = JSON.stringify(JSON.parse(item.toolCall.arguments), null, 2);
  } catch {
    parsedArgs = item.toolCall.arguments;
  }

  return createElement(
    "details",
    { "data-tool-output": "true", style: { margin: "4px 0", border: "1px solid #ddd", borderRadius: 4, padding: 8 } },
    createElement(
      "summary",
      { style: { cursor: "pointer", fontSize: 13, fontWeight: 500 } },
      `Tool: ${item.toolCall.name} — ${statusLabel}`
    ),
    createElement("pre", { style: { fontSize: 11, whiteSpace: "pre-wrap", margin: "4px 0" } }, `Input:\n${parsedArgs}`),
    item.status !== "in_progress" && createElement(
      "pre",
      {
        style: {
          fontSize: 11,
          whiteSpace: "pre-wrap",
          margin: "4px 0",
          color: item.status === "failed" ? "red" : undefined
        }
      },
      `Output:\n${item.error ? item.error.message : typeof item.output === "string" ? item.output : JSON.stringify(item.output, null, 2)}`
    )
  );
}

/**
 * Pick the built-in default renderer for a `suspension` item, in order:
 *  1. `item.render.component` — if it names a registered `renderers.component`
 *     entry, the author's custom component wins (the escape hatch for schemas
 *     richer than the bounded default can handle).
 *  2. by `reason`: `human_approval` → the approve/reject card; `human_input` →
 *     by `resumeSchema` shape (free-text question, enum selection, or flat form).
 *  3. fallback to the approval card.
 *
 * Reached only after the custom `renderers.suspension` slot and the `false`
 * suppression have been checked, so this never overrides an app's own renderer.
 */
function chooseSuspensionRenderer(
  item: SuspensionItem,
  renderers: RendererRegistry | undefined
): BlockComponentType {
  const componentKey = item.render?.component;
  if (componentKey !== undefined) {
    const custom = renderers?.component?.[componentKey];
    if (custom !== undefined && custom !== false) return custom;
  }

  switch (suspensionShape(item)) {
    case "form":
      return SchemaFormRenderer;
    case "selection":
      return SelectionRenderer;
    case "question":
      // Also the fallback for a schema richer than the bounded set with no custom
      // component — the free-text box is the safest actionable default.
      return QuestionRenderer;
    case "approval":
    default:
      return ApprovalRenderer;
  }
}

/** Map of item types to built-in fallback renderers. */
const BUILT_IN_FALLBACKS: Record<string, ((item: OutputItem) => ReactNode) | undefined> = {
  message: (item) => renderMessageFallback(item as MessageItem),
  reasoning: (item) => renderReasoningFallback(item as ReasoningItem),
  status: (item) => renderStatusFallback(item as StatusItem),
  error: (item) => renderErrorFallback(item as ErrorItem),
  tool_output: (item) => renderBlockToolOutputFallback(item as ToolOutputItem)
  // `suspension` is handled explicitly in renderItem so it can receive the
  // stream-derived `isResolved` flag (which this `{ item }`-only map can't carry).
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
  const { item, isResolved, resolution } = props;

  // Non-renderable types: bail early (no hooks called on this path).
  if (NON_RENDERABLE_TYPES.has(item.type)) {
    return null;
  }

  return renderItem(item, isResolved, resolution);
}

/**
 * Internal rendering logic — separated so the non-renderable early-return
 * doesn't violate React's rules of hooks (hooks must be called
 * unconditionally within a component).
 */
function renderItem(
  item: OutputItem,
  isResolved?: boolean,
  resolution?: SuspensionStatus
): ReactNode {
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

  // Component items whose key matches a registered container renderer are
  // subsumed by the container — suppress them to avoid a raw JSON fallback.
  // This handles both old items (no ownedBy) and new container-scoped items.
  if (
    item.type === "component" &&
    componentKey !== undefined &&
    renderers?.container?.[componentKey] !== undefined &&
    renderers.container[componentKey] !== false
  ) {
    return null;
  }

  // 2a. Suspension default card — dispatched by render.component / reason /
  // schema shape (FIX-849), handled explicitly so the chosen renderer receives
  // the stream-derived `isResolved` flag and goes read-only once its
  // `suspension_resume` item has arrived (prevents a duplicate-resume 409).
  if (item.type === "suspension") {
    const suspItem = item as SuspensionItem;
    const Renderer = chooseSuspensionRenderer(suspItem, renderers);
    return createElement(Renderer, { item: suspItem, isResolved, resolution });
  }

  // 2b. Built-in fallback (message, status, error, etc.).
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
