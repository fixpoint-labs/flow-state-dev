/**
 * Resolve a `BlockValue.ref`'s `sourceItemId` to the human-readable source
 * block name and a handle on the source item itself. The flatten-at-emit
 * invariant (FIX-413) guarantees a ref points one hop directly at a
 * content-bearing item — either a `BlockTraceItem` or a `MessageItem`
 * (FIX-480 streaming-text generators emit refs to their own message).
 *
 * Returns `null` when the source item is no longer in the live trace
 * (retention eviction). Callers should degrade the visual gracefully.
 */
import type { DevtoolItem } from "./item-types";

export type SourceBlockRef = {
  blockName: string;
  blockInstanceId: string;
  item: DevtoolItem;
};

export function resolveSourceBlock(
  sourceItemId: string,
  lookup: (id: string) => DevtoolItem | undefined,
): SourceBlockRef | null {
  const item = lookup(sourceItemId);
  if (!item) return null;

  // BlockTraceItem carries blockName + blockInstanceId at the top level.
  if (item.type === "block_trace") {
    return {
      blockName: item.blockName,
      blockInstanceId: item.provenance.blockInstanceId,
      item,
    };
  }

  // MessageItem (and any other content-bearing item) — fall back to
  // provenance for the producing block's identity.
  if (item.provenance) {
    return {
      blockName: item.provenance.blockName,
      blockInstanceId: item.provenance.blockInstanceId,
      item,
    };
  }

  return null;
}
