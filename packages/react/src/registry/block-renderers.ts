/**
 * Renderer registry types used by FlowProvider and item renderers.
 *
 * Renderers are keyed by item type. For `component` and `container` items,
 * a secondary lookup by `item.component` resolves a specific component.
 */
import type { ComponentType } from "react";

/**
 * Component shape accepted in renderer maps.
 */
export type BlockComponentType = ComponentType<any>;

/**
 * Canonical renderer registry shape.
 *
 * Class-based item types (`message`, `reasoning`, etc.) are resolved directly.
 * `component` and `container` items use a secondary keyed map so that
 * `renderers.component?.["chart"]` resolves a chart-specific component.
 */
export type RendererRegistry = {
  message?: BlockComponentType;
  reasoning?: BlockComponentType;
  block_output?: BlockComponentType;
  status?: BlockComponentType;
  error?: BlockComponentType;
  step_error?: BlockComponentType;
  component?: Record<string, BlockComponentType>;
  container?: Record<string, BlockComponentType>;
};

/**
 * @deprecated Use `RendererRegistry` instead.
 */
export type BlockRendererMap = Record<string, BlockComponentType>;

/**
 * Resolves a renderer for a given item type and optional component key.
 */
export function resolveRenderer(
  renderers: RendererRegistry | undefined,
  itemType: string,
  componentKey?: string
): BlockComponentType | undefined {
  if (renderers === undefined) {
    return undefined;
  }

  if (itemType === "component" && componentKey !== undefined) {
    return renderers.component?.[componentKey];
  }

  if (itemType === "container" && componentKey !== undefined) {
    return renderers.container?.[componentKey];
  }

  return (renderers as Record<string, BlockComponentType | undefined>)[itemType];
}
