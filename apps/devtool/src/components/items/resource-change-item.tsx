import type { ResourceChangeItem } from "@flow-state-dev/core/items";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function ResourceChangeItemView({ item }: { item: ResourceChangeItem }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500">
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <Badge variant="outline" className="text-[10px] px-1 py-0 border-slate-700 text-slate-500">
        {item.changeType}
      </Badge>
      <span className="font-mono">{item.resourcePath}</span>
      <span className="text-slate-600">({item.scope})</span>
    </div>
  );
}
