/**
 * Block output renderer that resolves custom components from FlowProvider context.
 */
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ReactNode
} from "react";
import type { BlockOutputItem, ItemStatus } from "@flow-state-dev/core/items";
import { useFlowContext } from "../context/FlowContext";
import { resolveRenderer } from "../registry/block-renderers";

/**
 * Props for rendering one `fsd:block_output` item.
 */
export type BlockRendererComponentProps = {
  item: BlockOutputItem;
};

/**
 * Metadata exposed to block components via useBlockContext().
 */
export type BlockMetadata = {
  blockName: string;
  renderKey?: string;
  status: ItemStatus;
  item: BlockOutputItem;
};

const BlockMetadataCtx = createContext<BlockMetadata | null>(null);

/**
 * Reads block metadata for the currently rendering block-output component.
 */
export function useBlockContext(): BlockMetadata {
  const ctx = useContext(BlockMetadataCtx);
  if (ctx === null) {
    throw new Error("useBlockContext must be used inside a block renderer");
  }

  return ctx;
}

function asComponentProps(output: unknown): Record<string, unknown> {
  if (typeof output === "object" && output !== null && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }

  return {};
}

/**
 * Renders one block output item via context-provided renderer mapping or fallback payload view.
 */
export function BlockRenderer(
  props: BlockRendererComponentProps
): ReactNode | Record<string, unknown> {
  const { blockRenderers } = useFlowContext();
  const renderKey = props.item.renderKey ?? props.item.blockName;
  const Component = resolveRenderer(blockRenderers, renderKey);

  const metadata = useMemo<BlockMetadata>(
    () => ({
      blockName: props.item.blockName,
      renderKey: props.item.renderKey,
      status: props.item.status,
      item: props.item
    }),
    [props.item]
  );

  if (Component !== undefined) {
    return createElement(
      BlockMetadataCtx.Provider,
      { value: metadata },
      createElement(Component, asComponentProps(props.item.output))
    );
  }

  return {
    type: "block-output",
    renderKey,
    blockName: props.item.blockName,
    status: props.item.status,
    output: props.item.output,
    itemId: props.item.id
  };
}
