/**
 * BlockValue construction, resolution, and type-guard helpers.
 *
 * `BlockValue<T>` is the discriminated union carried on `BlockOutputItem.output`
 * (FIX-413). This module owns the pure functions that:
 *  - construct the three cases (`inline`, `ref`, `structure`),
 *  - resolve a `BlockValue` to its typed payload `T` via an item-id lookup,
 *  - discriminate at runtime without depending on the core `zod` surface.
 *
 * Resolution is O(1) per ref because the executor enforces flatten-at-emit:
 * every `ref` points directly to a content-bearing item, never another ref.
 */
import type { BlockOutputItem, BlockValue, StructureShape } from "./types";

/** Construct an inline BlockValue carrying novel content. */
export function inlineBlockValue<T>(value: T): BlockValue<T> {
  return { kind: "inline", value };
}

/** Construct a ref BlockValue pointing at another item's content. */
export function refBlockValue(sourceItemId: string): BlockValue<never> {
  return { kind: "ref", sourceItemId };
}

/** Construct a structure BlockValue describing a container of nested BlockValues. */
export function structureBlockValue<T>(shape: StructureShape): BlockValue<T> {
  return { kind: "structure", shape };
}

/**
 * Runtime type guard. Useful for incremental migrations and defensive reads
 * at boundaries where an older raw value might sneak in — callers should
 * treat a non-BlockValue as an `inline` with that value.
 */
export function isBlockValue(candidate: unknown): candidate is BlockValue {
  if (typeof candidate !== "object" || candidate === null) return false;
  const kind = (candidate as { kind?: unknown }).kind;
  return kind === "inline" || kind === "ref" || kind === "structure";
}

/**
 * Lookup signature used by `resolveBlockValue`. Passing the live item index
 * avoids coupling the resolver to any particular store shape.
 */
export type BlockOutputLookup = (itemId: string) => BlockOutputItem | undefined;

/**
 * Resolve a BlockValue to its typed payload `T`.
 *
 * - `inline` → returns `value` directly.
 * - `ref` → looks up the target item and resolves its BlockValue.
 *   Returns `undefined` if the target is missing (e.g., evicted).
 * - `structure` → deep-resolves each entry, reconstructing the container.
 *
 * Safe against cycles because the executor guarantees flatten-at-emit: a ref
 * never points at another ref. We still bail on a second ref hop defensively.
 */
export function resolveBlockValue<T = unknown>(
  value: BlockValue<unknown> | undefined,
  lookup: BlockOutputLookup
): T | undefined {
  if (value === undefined) return undefined;
  return resolveInternal(value, lookup, 0) as T | undefined;
}

function resolveInternal(
  value: BlockValue<unknown>,
  lookup: BlockOutputLookup,
  refHops: number
): unknown {
  if (value.kind === "inline") {
    return value.value;
  }

  if (value.kind === "ref") {
    if (refHops > 1) {
      // flatten-at-emit makes this unreachable for well-formed data; guard
      // anyway so an adapter bug or forged payload cannot spin forever.
      return undefined;
    }
    const target = lookup(value.sourceItemId);
    if (target === undefined) return undefined;
    return resolveInternal(target.output, lookup, refHops + 1);
  }

  // structure — entries may themselves be inline / ref / (rarely) structure.
  if (value.shape.container === "array") {
    return value.shape.entries.map((entry) => resolveInternal(entry, lookup, 0));
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value.shape.entries)) {
    result[key] = resolveInternal(value.shape.entries[key], lookup, 0);
  }
  return result;
}

/**
 * Build a lookup closure from a flat items list. Callers with a Map already
 * indexed by id should wrap the Map directly; this helper exists for the
 * common case of a response's in-memory items array.
 */
export function buildBlockOutputLookup(items: readonly BlockOutputItem[] | readonly { id: string; type: string }[]): BlockOutputLookup {
  const index = new Map<string, BlockOutputItem>();
  for (const item of items) {
    if ((item as { type: string }).type === "block_output") {
      index.set(item.id, item as BlockOutputItem);
    }
  }
  return (id) => index.get(id);
}
