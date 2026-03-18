/**
 * Tier 3 (debug-only): State mutation indicator — subtle dot/line.
 */
import type { StateChangeItem } from "@flow-state-dev/core/items";

export function StateChangeItemView({ item }: { item: StateChangeItem }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-600 font-mono">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-600/60 shrink-0" />
      <span className="text-slate-500">{item.scope}</span>
      <span>{item.operation}</span>
      {item.path && <span className="text-slate-700 truncate">{item.path}</span>}
    </div>
  );
}
