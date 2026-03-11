import type { StateChangeItem } from "@flow-state-dev/core/items";
import { Badge } from "@/components/ui/badge";

export function StateChangeItemView({ item }: { item: StateChangeItem }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className="font-mono text-slate-600">Δ</span>
      <Badge variant="outline" className="text-[10px] px-1 py-0 border-slate-700 text-slate-500">
        {item.scope}
      </Badge>
      <span className="font-mono">{item.operation}</span>
      {item.path && <span className="text-slate-600 font-mono">{item.path}</span>}
    </div>
  );
}
