/**
 * Projections from the versioned `ResourceStateStore` reads back down to bare
 * state.
 *
 * `get` / `getAll` / `getByPrefix` carry a version beside each state, which is
 * what makes a read usable as the basis for a conditional write. Most readers
 * only ever wanted the state, and these are how they get it.
 *
 * These are the *checked* boundary out of the versioned shape, not a workaround
 * for one. `VersionedResourceState` is branded (see its doc comment) precisely
 * so that handing a versioned read where bare state is expected fails to
 * compile — which leaves exactly one legitimate way down, and this is it.
 * Inline `.state` reads remain possible where a single field is wanted; these
 * exist for the whole-read and whole-map cases, and keep the projection
 * greppable.
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
