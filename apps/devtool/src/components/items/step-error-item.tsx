import type { StepErrorItem } from "@flow-state-dev/core/items";
import { AlertTriangle } from "lucide-react";

export function StepErrorItemView({ item }: { item: StepErrorItem }) {
  return (
    <div className="rounded bg-amber-950/30 border border-amber-900/50 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span className="text-xs font-medium text-amber-400">Step Error</span>
        {item.recovered && (
          <span className="text-[10px] text-amber-600">(recovered)</span>
        )}
      </div>
      <p className="mt-1 text-xs text-amber-300 pl-5">{item.message}</p>
    </div>
  );
}
