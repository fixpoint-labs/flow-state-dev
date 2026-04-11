/**
 * Collection renderer for output item arrays.
 *
 * Items are rendered in the order provided — callers (useSession, etc.)
 * are responsible for sorting.
 */
import { createElement, type ReactNode } from "react";
import type { ComponentItem, ContainerItem, OutputItem } from "@flow-state-dev/core/items";
import { useFlowContext } from "../context/FlowContext";
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
 * Renders output items in the order provided.
 *
 * Does not re-sort — useSession already sorts by timestamp with
 * itemIndex as tiebreaker.
 *
 * Items owned by a container that has a registered renderer are suppressed —
 * the container renderer is responsible for displaying its owned items.
 */
export function ItemsRenderer(props: ItemsRendererProps): ReactNode[] {
  const { deduplicateByKey = true } = props;
  const { renderers } = useFlowContext();
  const items = deduplicateByKey ? deduplicateComponentItems(props.items) : props.items;

  const suppressedOwners = buildSuppressedOwners(items, renderers?.container);

  return items
    .filter((item) => {
      if (suppressedOwners === null) return true;
      const ownedBy = (item as OutputItem & { ownedBy?: string }).ownedBy;
      if (ownedBy === undefined || !suppressedOwners.has(ownedBy)) return true;
      // Only suppress item types the container manages internally.
      // Primary output (messages, reasoning, etc.) always renders normally.
      return !CONTAINER_MANAGED_TYPES.has(item.type);
    })
    .map((item) =>
      createElement(ItemRenderer, { item, key: item.id })
    );
}
