/**
 * Shared utilities for the drain-pool pattern blocks.
 *
 * Internal only — not re-exported from the pattern's public index.
 */
import type { DrainPoolProjection } from "./schemas";

/**
 * Generate a unique item id. Prefers WebCrypto's `randomUUID`; falls back
 * to a timestamp+random string for runtimes that lack it.
 */
export function randomItemId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `item-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Strip the verbose per-item `items` map out of the projection before
 * emitting it as a devtool component. Keeps the UI payload small and
 * avoids leaking internal lifecycle bookkeeping to clients.
 */
export function sanitizeStats(state: DrainPoolProjection) {
  const { items: _items, ...rest } = state;
  return rest;
}
