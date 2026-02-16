/**
 * Global block renderer registry used by React-facing rendering helpers.
 */
import type { BlockOutputItem, ItemStatus } from "@flow-state-dev/core/items";

/**
 * Props passed to custom block renderer components.
 */
export type BlockRendererProps = {
  blockName: string;
  renderName?: string;
  output: unknown;
  item: BlockOutputItem;
  status: ItemStatus;
};

/**
 * Component shape accepted by the block renderer registry.
 */
export type BlockComponentType = (props: BlockRendererProps) => unknown;

const blockRenderers = new Map<string, BlockComponentType>();

/**
 * Registers or replaces a block renderer for the supplied render key.
 */
export function registerBlockRenderer(
  renderKey: string,
  component: BlockComponentType
): void {
  const key = normalizeKey(renderKey);
  blockRenderers.set(key, component);
}

/**
 * Resolves a renderer for `renderName ?? blockName`.
 */
export function getBlockRenderer(
  renderKey: string
): BlockComponentType | undefined {
  return blockRenderers.get(normalizeKey(renderKey));
}

/**
 * Clears all registered renderer mappings.
 */
export function clearBlockRenderers(): void {
  blockRenderers.clear();
}

/**
 * Lists registered renderer keys in deterministic order.
 */
export function listBlockRendererKeys(): string[] {
  return Array.from(blockRenderers.keys()).sort((left, right) =>
    left.localeCompare(right)
  );
}

function normalizeKey(value: string): string {
  const key = value.trim();
  if (key.length === 0) {
    throw new Error("Renderer key must be a non-empty string");
  }

  return key;
}
