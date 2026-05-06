/**
 * Inline BlockValue resolver for react components. Mirrors the shape of
 * `resolveBlockValueInternal` (which lives in core/items/internal), but is
 * inlined here so the react package can stay type-only on core, per the
 * boundary rules in scripts/validate-package-boundaries.mjs.
 *
 * Handles the three BlockValue cases:
 *   - `inline` → returns `value` directly.
 *   - `ref`    → looks up the source item (BlockOutputItem or MessageItem)
 *                in the supplied items list and recurses one hop. Anything
 *                deeper is treated as a missed reference and returns undefined.
 *   - `structure` → deep-resolves each entry, reconstructing the container.
 */
import type { BlockOutputItem, OutputItem } from "@flow-state-dev/core/items";

export type AnyBlockValue =
  | { kind: "inline"; value: unknown }
  | { kind: "ref"; sourceItemId: string }
  | {
      kind: "structure";
      shape:
        | { container: "array"; entries: AnyBlockValue[] }
        | { container: "object"; entries: Record<string, AnyBlockValue> };
    };

export function resolveBlockValueLocal(
  value: BlockOutputItem["output"] | undefined,
  items: readonly OutputItem[],
): unknown {
  if (value === undefined) return undefined;
  return resolveLocal(value as AnyBlockValue, items, 0);
}

function resolveLocal(value: AnyBlockValue, items: readonly OutputItem[], hops: number): unknown {
  if (value.kind === "inline") return value.value;
  if (value.kind === "ref") {
    if (hops > 1) return undefined;
    const target = items.find((i) => i.id === value.sourceItemId) as
      | (OutputItem | BlockOutputItem)
      | undefined;
    if (!target) return undefined;
    if ((target as { type: string }).type === "block_output") {
      return resolveLocal((target as BlockOutputItem).output as AnyBlockValue, items, hops + 1);
    }
    if (target.type === "message") {
      return target.content
        .filter((p): p is { type: "output_text"; text: string } => p.type === "output_text")
        .map((p) => p.text)
        .join("");
    }
    return undefined;
  }
  if (value.shape.container === "array") {
    return value.shape.entries.map((entry) => resolveLocal(entry, items, 0));
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value.shape.entries)) {
    out[key] = resolveLocal(value.shape.entries[key], items, 0);
  }
  return out;
}
