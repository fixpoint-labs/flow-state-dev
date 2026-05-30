// Shared block-trace lookup used by both the sequencer and the router to build
// `ref` BlockValue descriptors (FIX-413). A dispatching block emits a
// `block_trace` item for its child; the parent then points its own output at
// that item by id rather than duplicating the child's content. This file is the
// single home for the items-walk that resolves a block instance to its emitted
// trace id — previously duplicated between `sequencer.ts` and `router.ts`.
import type { BlockContext } from "../../types/block";

/**
 * Look up the id of the most-recently emitted `block_trace` item whose
 * provenance matches the given block instance.
 *
 * Scans the response's item log back-to-front so the latest matching trace
 * wins — correct under concurrency because each parallel branch runs at a
 * unique path and therefore carries a unique `blockInstanceId`.
 *
 * Defensively handles unit-test contexts where `ctx.response` is undefined or
 * its `getItems` accessor is missing (partial mocks); returns `undefined` so
 * callers fall back to an inline descriptor.
 */
export function findBlockTraceIdByInstance(
  ctx: BlockContext,
  blockInstanceId: string
): string | undefined {
  if (ctx.response === undefined) return undefined;
  if (typeof ctx.response.getItems !== "function") return undefined;
  const items = ctx.response.getItems();
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i] as { id: string; type: string; provenance?: { blockInstanceId?: string } };
    if (item.type === "block_trace" && item.provenance?.blockInstanceId === blockInstanceId) {
      return item.id;
    }
  }
  return undefined;
}
