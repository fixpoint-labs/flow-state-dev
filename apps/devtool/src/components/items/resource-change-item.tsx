/**
 * Tier 3 (debug-only): Resource change indicator — subtle dot/line.
 */
import type { ResourceChangeItem } from "@flow-state-dev/core/items";

export function ResourceChangeItemView({ item }: { item: ResourceChangeItem }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-600 font-mono">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-600/60 shrink-0" />
      <span className="text-slate-500">{item.changeType}</span>
      <span className="truncate">{item.resourcePath}</span>
      <span className="text-slate-700">({item.scope})</span>
    </div>
  );
}
