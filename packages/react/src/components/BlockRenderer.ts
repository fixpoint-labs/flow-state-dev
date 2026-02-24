/**
 * Item renderer that resolves custom components from the FlowProvider renderer registry.
 *
 * Handles `block_output`, `component`, and `container` item types.
 * Uses `item.type` for primary lookup and `item.component` for keyed types.
 */
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ReactNode
} from "react";
import type {
  BlockOutputItem,
  ComponentItem,
  ContainerItem,
  ItemStatus,
  OutputItem
} from "@flow-state-dev/core/items";
import { useFlowContext } from "../context/FlowContext";
import { resolveRenderer } from "../registry/block-renderers";

/**
 * Props for rendering one item via the renderer registry.
 */
export type BlockRendererComponentProps = {
  item: OutputItem;
};

/**
 * Metadata exposed to rendered components via useItemContext().
 */
export type ItemMetadata = {
  blockName: string;
  status: ItemStatus;
  item: OutputItem;
};

/**
 * @deprecated Use `ItemMetadata` instead.
 */
export type BlockMetadata = ItemMetadata;

const ItemMetadataCtx = createContext<ItemMetadata | null>(null);

/**
 * Reads item metadata for the currently rendering component.
 */
export function useItemContext(): ItemMetadata {
  const ctx = useContext(ItemMetadataCtx);
  if (ctx === null) {
    throw new Error("useItemContext must be used inside a renderer component");
  }

  return ctx;
}

/**
 * @deprecated Use `useItemContext()` instead.
 */
export const useBlockContext = useItemContext;

function asComponentProps(output: unknown): Record<string, unknown> {
  if (typeof output === "object" && output !== null && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }

  return {};
}

/**
 * Renders an item via the renderer registry from FlowProvider context.
 */
export function BlockRenderer(props: BlockRendererComponentProps): ReactNode {
  const { renderers } = useFlowContext();
  const { item } = props;

  const componentKey =
    item.type === "component"
      ? (item as ComponentItem).component
      : item.type === "container"
        ? (item as ContainerItem).component
        : undefined;

  const Component = resolveRenderer(renderers, item.type, componentKey);

  const metadata = useMemo<ItemMetadata>(
    () => ({
      blockName:
        "blockName" in item ? (item as BlockOutputItem).blockName : item.type,
      status: item.status,
      item
    }),
    [item]
  );

  if (Component !== undefined) {
    const componentProps =
      item.type === "component"
        ? (item as ComponentItem).data
        : item.type === "block_output"
          ? asComponentProps((item as BlockOutputItem).output)
          : {};

    return createElement(
      ItemMetadataCtx.Provider,
      { value: metadata },
      createElement(Component, componentProps)
    );
  }

  // Fallback: render as JSON for development visibility.
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
