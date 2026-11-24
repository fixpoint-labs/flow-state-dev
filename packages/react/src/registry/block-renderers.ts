/**
 * Renderer registry types used by FlowProvider and item renderers.
 *
 * Renderers are keyed by item type. A `data` item resolves by its
 * `dataType` and a `container` item by its `component`; a suspension that
 * names a renderer with `render.component` resolves in `component`.
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
 * - `data` (by `dataType`) and `container` (by `component`) use a keyed map.
 * - `component` holds the renderers a suspension names with `render.component`.
 * - Pass `false` to explicitly suppress rendering for a type.
 */
export type RendererRegistry = {
  message?: BlockComponentType | false;
  reasoning?: BlockComponentType | false;
  block_trace?: BlockComponentType | false;
  tool_output?: BlockComponentType | false;
  status?: BlockComponentType | false;
  source?: BlockComponentType | false;
  error?: BlockComponentType | false;
  /**
   * Custom renderer for `type === "suspension"` items. Pass `false` to suppress
   * inline rendering (for headless layouts that use `useSuspensions` + a modal/sidebar).
   * When unset, `<ApprovalRenderer>` renders as the built-in fallback.
   */
  suspension?: BlockComponentType | false;
  // FIX-2848.
  /**
   * Renderer for a `stopped` conversation line: a turn the user stopped,
   * drawn after its last line. Not an item type: it receives `{ line }`.
   * When unset, a plain "Stopped" line renders; `false` draws none.
   */
  stopped?: BlockComponentType | false;
  /**
   * Renderers a suspension item names with `render.component`, for a schema
   * richer than the built-in cards handle. Not an item type.
   */
  component?: Record<string, BlockComponentType | false>;
  container?: Record<string, BlockComponentType | false>;
  /**
   * Renderers for `data` items, keyed by `dataType`: how a dataType gets
   * drawn, generative UI included. A data item with no renderer here renders
   * nothing.
   */
  data?: Record<string, BlockComponentType | false>;
};

/**
 * Resolves a renderer for a given item type and optional component key (a
 * `data` item's `dataType`).
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

  if (itemType === "container" && componentKey !== undefined) {
    return renderers.container?.[componentKey];
  }

  if (itemType === "data" && componentKey !== undefined) {
    return renderers.data?.[componentKey];
  }

  return (renderers as Record<string, BlockComponentType | false | undefined>)[itemType];
}
