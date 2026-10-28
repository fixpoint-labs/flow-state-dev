/**
 * Tier 2: Subtle grouping indicator — not a full row, just a left-border indent marker.
 * Block name and label appear as small inline text.
 */
import type { ContainerItem } from "@flow-state-dev/core/items";

export function ContainerItemView({ item }: { item: ContainerItem }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-fs-ink3 border-l border-fs-ink/30 pl-2 py-0.5">
      <span className="font-fs-mono">{item.blockName}</span>
      {item.label && <span className="text-fs-ink4">· {item.label}</span>}
    </div>
  );
}
