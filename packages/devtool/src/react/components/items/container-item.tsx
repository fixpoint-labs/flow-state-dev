/**
 * Tier 2: Subtle grouping indicator — not a full row, just a left-border indent marker.
 * Block name and label appear as small inline text.
 */
import type { ContainerItem } from "@flow-state-dev/core/items";

export function ContainerItemView({ item }: { item: ContainerItem }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-600 border-l-2 border-slate-700/50 pl-2 py-0.5">
      <span className="font-mono">{item.blockName}</span>
      {item.label && <span className="text-slate-700">· {item.label}</span>}
    </div>
  );
}
