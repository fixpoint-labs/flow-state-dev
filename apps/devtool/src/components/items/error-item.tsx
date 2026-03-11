import type { ErrorItem } from "@flow-state-dev/core/items";
import { AlertCircle } from "lucide-react";

export function ErrorItemView({ item }: { item: ErrorItem }) {
  return (
    <div className="rounded bg-red-950/30 border border-red-900/50 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
        <span className="text-xs font-medium text-red-400">Error</span>
        {item.code && <span className="text-[10px] font-mono text-red-500">({item.code})</span>}
      </div>
      <p className="mt-1 text-xs text-red-300 pl-5">{item.message}</p>
    </div>
  );
}
