import type { ContextItem } from "@flow-state-dev/core/items";
import { Eye } from "lucide-react";

export function ContextItemView({ item }: { item: ContextItem }) {
  return (
    <div className="flex items-start gap-1.5 text-xs text-slate-600">
      <Eye className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <span className="whitespace-pre-wrap">{item.text}</span>
    </div>
  );
}
