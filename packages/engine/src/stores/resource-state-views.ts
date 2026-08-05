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
 *
 * ## Why they are generic in the state shape
 *
 * A caller that knows what it stored wants that shape back, not bare
 * `JsonObject`. Without the type parameter every such caller re-asserted on the
 * result, and the assertion had to cross `JsonObject` -> its own shape, which
 * invited the `as unknown as` form. `T` moves that assertion into the call
 * itself, where it is named and greppable, and defaults to `JsonObject` so
 * callers that only want bare state are unchanged.
 *
 * `T` is *asserted*, not validated: nothing here checks the stored row against
 * it at runtime, exactly as the cast it replaces did not. What changes is that
 * the assertion is visible in the call rather than hidden behind a double cast.
 * The `JsonObject` bound is what keeps it honest — it rejects any `T` the store
 * could not have held, including `VersionedResourceState` itself, so these
 * cannot be used to launder the versioned shape back in.
 */
import type { JsonObject } from "@flow-state-dev/core/types";
import type { VersionedResourceState } from "./types";

/**
 * The state from a single versioned read, or `undefined` when there is no live row.
 *
 * @typeParam T - The stored state's shape. Asserted, not validated; defaults to `JsonObject`.
 */
export function toBareState<T extends JsonObject = JsonObject>(
  entry: VersionedResourceState | undefined
): T | undefined {
  return entry?.state as T | undefined;
}

/**
 * Drop the versions from a bulk read, keeping the keys.
 *
 * @typeParam T - The stored state's shape. Asserted, not validated; defaults to `JsonObject`.
 */
export function toBareStates<T extends JsonObject = JsonObject>(
  entries: Record<string, VersionedResourceState>
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, entry] of Object.entries(entries)) {
    result[key] = entry.state as T;
  }
  return result;
}
