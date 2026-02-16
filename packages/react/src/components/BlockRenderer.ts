/**
 * Block output renderer that resolves custom components from the renderer registry.
 */
import type { BlockOutputItem } from "@flow-state-dev/core/items";
import { getBlockRenderer } from "../registry/block-renderers";

/**
 * Props for rendering one `fsd:block_output` item.
 */
export type BlockRendererComponentProps = {
  item: BlockOutputItem;
};

/**
 * Renders one block output item via custom renderer mapping or fallback payload view.
 */
export function BlockRenderer(
  props: BlockRendererComponentProps
): unknown {
  const renderKey = props.item.renderName ?? props.item.blockName;
  const customRenderer = getBlockRenderer(renderKey);

  if (customRenderer !== undefined) {
    return customRenderer({
      blockName: props.item.blockName,
      renderName: props.item.renderName,
      output: props.item.output,
      status: props.item.status,
      item: props.item
    });
  }

  return {
    type: "block-output",
    renderKey,
    blockName: props.item.blockName,
    renderName: props.item.renderName,
    status: props.item.status,
    output: props.item.output,
    itemId: props.item.id
  };
}
