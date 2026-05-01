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
 *
 * FIX-480 §3.2: refs may now point at `MessageItem` ids (in addition to
 * `BlockOutputItem` ids), so a streaming-text generator's `block_output`
 * can carry a ref to its own emitted message instead of duplicating the
 * text. Resolution returns the joined `output_text` content.
 */
import type { BlockOutputItem, BlockValue, MessageItem, OutputItem, StructureShape } from "./types";

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
 * Lookup signature used by `resolveBlockValue`. Returns any item type — the
 * resolver branches on `target.type`. FIX-480 broadens this from
 * `BlockOutputItem`-only to support refs targeting `MessageItem`s.
 */
export type ItemLookup = (itemId: string) => OutputItem | undefined;

/**
 * Resolve a BlockValue to its typed payload `T`.
 *
 * - `inline` → returns `value` directly.
 * - `ref` → looks up the target item:
 *     - `block_output` → recurse into its own BlockValue.
 *     - `message` → returns the joined `output_text` content cast to `T`
 *       (FIX-480: streaming-text generators emit refs to their own message).
 *   Returns `undefined` if the target is missing (e.g., evicted).
 * - `structure` → deep-resolves each entry, reconstructing the container.
 *
 * Safe against cycles because the executor guarantees flatten-at-emit: a ref
 * never points at another ref. We still bail on a second ref hop defensively.
 */
export function resolveBlockValue<T = unknown>(
  value: BlockValue<unknown> | undefined,
  lookup: ItemLookup
): T | undefined {
  if (value === undefined) return undefined;
  return resolveInternal(value, lookup, 0) as T | undefined;
}

function resolveInternal(
  value: BlockValue<unknown>,
  lookup: ItemLookup,
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
    if (target.type === "block_output") {
      return resolveInternal((target as BlockOutputItem).output, lookup, refHops + 1);
    }
    if (target.type === "message") {
      // Terminal node — the joined text IS the resolved value. No recursion.
      return joinMessageText(target as MessageItem);
    }
    // Unknown ref target type. Returning `undefined` is the safe choice —
    // callers already tolerate ref-misses (e.g. retention eviction), and a
    // hard throw would break adapters for any future non-message content
    // that legitimately becomes ref-able.
    return undefined;
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
 * Concatenate a `MessageItem`'s `output_text` content blocks into a single
 * string. Used when a `BlockValue.ref` points at a message — the resolved
 * value is the joined text the worker streamed.
 */
function joinMessageText(item: MessageItem): string {
  let out = "";
  for (const c of item.content) {
    if (c.type === "output_text") out += c.text;
  }
  return out;
}

/**
 * Build a lookup closure from a flat items list. Indexes every item by
 * id (not just `block_output`) so refs may resolve to `message` items
 * as well — FIX-480 widened the source pool. Callers with a Map already
 * indexed by id should wrap that directly.
 */
export function buildItemLookup(items: readonly OutputItem[] | readonly { id: string; type: string }[]): ItemLookup {
  const index = new Map<string, OutputItem>();
  for (const item of items) {
    index.set(item.id, item as OutputItem);
  }
  return (id) => index.get(id);
}
