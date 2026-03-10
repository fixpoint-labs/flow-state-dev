import type { ComponentItem } from "@flow-state-dev/core/items";
import { Puzzle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function ComponentItemView({ item }: { item: ComponentItem }) {
  return (
    <div className="rounded bg-slate-900/50 border border-slate-800 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <Puzzle className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <Badge variant="outline" className="text-[10px] px-1 py-0 border-slate-700 text-slate-400">
          component
        </Badge>
        <span className="text-xs text-slate-300 font-mono">{item.component}</span>
      </div>
      {Object.keys(item.data).length > 0 && (
        <div className="mt-1 pl-5 text-[10px] text-slate-500 font-mono">
          props: {JSON.stringify(item.data).slice(0, 100)}
        </div>
      )}
    </div>
  );
}
