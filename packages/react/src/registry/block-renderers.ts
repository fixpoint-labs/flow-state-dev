/**
 * Renderer registry types used by FlowProvider and item renderers.
 *
 * Renderers are keyed by item type. For `component` and `container` items,
 * a secondary lookup by `item.component` resolves a specific component.
 *
 * Any slot accepts `false` to explicitly suppress rendering (overrides
 * built-in fallbacks).
 */
import type { ComponentType } from "react";

/**
 * Component shape accepted in renderer maps.
 *
 * Uses `any` because TypeScript's function parameter contravariance prevents
 * `ComponentType<{ item: MessageItem }>` from being assignable to
 * `ComponentType<{ item: OutputItem }>`. The runtime contract is that
 * ItemRenderer passes `{ item }` with the correct item type for each slot.
 * Consumers narrow the type in their component signature.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BlockComponentType = ComponentType<any>;

/**
 * Canonical renderer registry shape.
 *
 * - Class-based item types (`message`, `reasoning`, etc.) are resolved directly.
 * - `component` and `container` use a secondary keyed map.
 * - Pass `false` to explicitly suppress rendering for a type.
 */
export type RendererRegistry = {
  message?: BlockComponentType | false;
  reasoning?: BlockComponentType | false;
  block_output?: BlockComponentType | false;
  block_tool_output?: BlockComponentType | false;
  status?: BlockComponentType | false;
  source?: BlockComponentType | false;
  error?: BlockComponentType | false;
  step_error?: BlockComponentType | false;
  component?: Record<string, BlockComponentType | false>;
  container?: Record<string, BlockComponentType | false>;
};

/**
 * Resolves a renderer for a given item type and optional component key.
 *
 * Returns:
 * - `BlockComponentType` — custom renderer to use
 * - `false` — explicitly suppressed (caller should return null)
 * - `undefined` — no renderer registered (fall through to fallback)
 */
export function resolveRenderer(
  renderers: RendererRegistry | undefined,
  itemType: string,
  componentKey?: string
): BlockComponentType | false | undefined {
  if (renderers === undefined) {
    return undefined;
  }

  if (itemType === "component" && componentKey !== undefined) {
    return renderers.component?.[componentKey];
  }

  if (itemType === "container" && componentKey !== undefined) {
    return renderers.container?.[componentKey];
  }

  return (renderers as Record<string, BlockComponentType | false | undefined>)[itemType];
}
