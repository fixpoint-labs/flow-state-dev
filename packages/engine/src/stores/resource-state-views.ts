/**
 * Projections from the versioned `ResourceStateStore` reads back down to bare
 * state.
 *
 * `get` / `getAll` / `getByPrefix` now carry a version beside each state, which
 * is what makes a read usable as the basis for a conditional write. Most
 * existing readers only ever wanted the state, and — importantly — the
 * versioned shape is *structurally assignable* to `JsonObject`, so dropping
 * these projections in would not be a type error anywhere. It would silently
 * change what those readers hand downstream. These helpers keep the unwrapping
 * explicit and in one place rather than spread as inline `.state` accesses.
 */
import type { JsonObject } from "@flow-state-dev/core/types";
import type { VersionedResourceState } from "./types";

/** The state from a single versioned read, or `undefined` when there is no live row. */
export function toState(
  entry: VersionedResourceState | undefined
): JsonObject | undefined {
  return entry?.state;
}

/** Drop the versions from a bulk read, keeping the keys. */
export function toStates(
  entries: Record<string, VersionedResourceState>
): Record<string, JsonObject> {
  const result: Record<string, JsonObject> = {};
  for (const [key, entry] of Object.entries(entries)) {
    result[key] = entry.state;
  }
  return result;
}
