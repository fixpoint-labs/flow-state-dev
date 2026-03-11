import type { StatusItem } from "@flow-state-dev/core/items";
import { Loader2 } from "lucide-react";

export function StatusItemView({ item }: { item: StatusItem }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500">
      <Loader2 className="h-3 w-3 animate-spin shrink-0" />
      <span>{item.message}</span>
    </div>
  );
}
