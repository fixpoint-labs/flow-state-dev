/**
 * Collection renderer for output item arrays.
 *
 * Items are rendered in the order provided — callers (useSession, etc.)
 * are responsible for sorting.
 */
import { createElement, Fragment, type ComponentType, type ReactNode } from "react";
import type {
  BlockToolOutputItem,
  ComponentItem,
  ContainerItem,
  OutputItem
} from "@flow-state-dev/core/items";
import { useFlowContext } from "../context/FlowContext";
import type { RendererRegistry } from "../registry/block-renderers";
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
  /**
   * When true, items produced by sub-agents (`agentType: "sub"`) are
   * rendered inline with the rest of the stream. Default: false — sub-agent
   * items are filtered out of the default conversation view. The data still
   * flows through `useSession().items`; use a custom renderer (e.g., a
   * per-agent panel) to surface it explicitly.
   */
  showSubAgents?: boolean;
  /**
   * When provided, consecutive `block_tool_output` items that survive the
   * dedup / sub-agent / container-owner filters are rendered through this
   * component as a single group instead of individually via the registry.
   *
   * The component receives the full batch of items for that segment.
   * Singletons still flow through the group wrapper for visual consistency.
   *
   * Non-tool items continue to render through the renderer registry via
   * `ItemRenderer` as normal.
   */
  toolGroupRenderer?: ComponentType<{ items: BlockToolOutputItem[] }>;
};

/**
 * A segment of the render stream after filtering and optional tool-call
 * grouping. `item` segments pass through to the renderer registry; `group`
 * segments represent a run of consecutive block_tool_output items that a
 * toolGroupRenderer should render as one unit.
 */
export type ItemRenderSegment =
  | { kind: "item"; item: OutputItem }
  | { kind: "group"; items: BlockToolOutputItem[] };

/**
 * Options for {@link buildItemRenderStream}. Mirrors the ItemsRenderer
 * public props but exposed separately so the filter + group logic is
 * unit-testable without a React tree.
 */
export type BuildItemRenderStreamOptions = {
  deduplicateByKey?: boolean;
  showSubAgents?: boolean;
  /**
   * When true, consecutive block_tool_output items in the filtered stream
   * are collapsed into `group` segments. Non-tool items break the run.
   */
  groupToolCalls?: boolean;
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
 * Builds a set of blockInstanceIds whose owning container has a registered
 * renderer. Items with `ownedBy` in this set are suppressed — the container
 * renderer is responsible for displaying them.
 */
function buildSuppressedOwners(
  items: OutputItem[],
  containerRenderers: Record<string, unknown> | undefined
): Set<string> | null {
  if (containerRenderers === undefined) return null;

  const suppressed = new Set<string>();
  for (const item of items) {
    if (item.type === "container") {
      const container = item as ContainerItem;
      const component = container.component;
      if (component !== undefined) {
        const renderer = containerRenderers[component];
        if (renderer !== undefined && renderer !== false) {
          suppressed.add(container.provenance.blockInstanceId);
        }
      }
    }
  }

  return suppressed.size > 0 ? suppressed : null;
}

/**
 * Item types that a container renderer manages internally: plan state
 * snapshots and tool call outputs. These are suppressed from the main
 * stream when owned by a container with a registered renderer.
 *
 * Primary output types (message, reasoning, status, error, etc.) always
 * render in the main stream even when owned by a container — they are
 * the user-facing response, not internal container state.
 */
const CONTAINER_MANAGED_TYPES = new Set([
  "component",
  "block_tool_output",
]);

/**
 * Pure helper: applies dedup / sub-agent / container-owner filters, then
 * optionally collapses consecutive block_tool_output runs into `group`
 * segments. Returns the ordered render stream.
 *
 * Exposed so consumers can test filter + grouping behavior without a React
 * tree. ItemsRenderer uses this internally.
 */
export function buildItemRenderStream(
  items: OutputItem[],
  renderers: RendererRegistry | undefined,
  options: BuildItemRenderStreamOptions = {}
): ItemRenderSegment[] {
  const { deduplicateByKey = true, showSubAgents = false, groupToolCalls = false } = options;

  const deduplicated = deduplicateByKey ? deduplicateComponentItems(items) : items;
  const visibleByAgent = showSubAgents
    ? deduplicated
    : deduplicated.filter((item) => item.agentType !== "sub");

  const suppressedOwners = buildSuppressedOwners(visibleByAgent, renderers?.container);

  const filtered = visibleByAgent.filter((item) => {
    if (suppressedOwners === null) return true;
    const ownedBy = (item as OutputItem & { ownedBy?: string }).ownedBy;
    if (ownedBy === undefined || !suppressedOwners.has(ownedBy)) return true;
    return !CONTAINER_MANAGED_TYPES.has(item.type);
  });

  if (!groupToolCalls) {
    return filtered.map((item) => ({ kind: "item", item }));
  }

  const out: ItemRenderSegment[] = [];
  let buf: BlockToolOutputItem[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    out.push({ kind: "group", items: buf });
    buf = [];
  };
  for (const item of filtered) {
    if (item.type === "block_tool_output") {
      buf.push(item as BlockToolOutputItem);
    } else {
      flush();
      out.push({ kind: "item", item });
    }
  }
  flush();
  return out;
}

/**
 * Renders output items in the order provided.
 *
 * Does not re-sort — useSession already sorts by timestamp with
 * itemIndex as tiebreaker.
 *
 * Items owned by a container that has a registered renderer are suppressed —
 * the container renderer is responsible for displaying its owned items.
 *
 * When `toolGroupRenderer` is provided, consecutive `block_tool_output`
 * items in the filtered stream render as a single group via the supplied
 * component rather than individually.
 */
export function ItemsRenderer(props: ItemsRendererProps): ReactNode[] {
  const { deduplicateByKey = true, showSubAgents = false, toolGroupRenderer } = props;
  const { renderers } = useFlowContext();

  const stream = buildItemRenderStream(props.items, renderers, {
    deduplicateByKey,
    showSubAgents,
    groupToolCalls: toolGroupRenderer !== undefined,
  });

  return stream.map((segment, index) => {
    if (segment.kind === "group") {
      const key = `tool-group-${segment.items[0]?.id ?? index}`;
      return createElement(
        Fragment,
        { key },
        createElement(toolGroupRenderer!, { items: segment.items })
      );
    }
    return createElement(ItemRenderer, { item: segment.item, key: segment.item.id });
  });
}
