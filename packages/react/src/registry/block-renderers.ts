/**
 * Block renderer type utilities used by FlowProvider and BlockRenderer.
 */
import type { ComponentType } from "react";

/**
 * Component shape accepted in FlowProvider `blockRenderers`.
 */
export type BlockComponentType = ComponentType<any>;

/**
 * Renderer map keyed by render key.
 */
export type BlockRendererMap = Record<string, BlockComponentType>;

/**
 * Normalizes renderer keys for deterministic lookup.
 */
export function normalizeRendererKey(value: string): string {
  const key = value.trim();
  if (key.length === 0) {
    throw new Error("Renderer key must be a non-empty string");
  }

  return key;
}

/**
 * Resolves one renderer by render key from a provider map.
 */
export function resolveRenderer(
  renderers: BlockRendererMap | undefined,
  renderKey: string
): BlockComponentType | undefined {
  if (renderers === undefined) {
    return undefined;
  }

  return renderers[normalizeRendererKey(renderKey)];
}
