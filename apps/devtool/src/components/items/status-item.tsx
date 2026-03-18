/**
 * Tier 2: Inline spinner + message text. Already minimal — no expand needed.
 */
import type { StatusItem } from "@flow-state-dev/core/items";
import { Loader2 } from "lucide-react";

export function StatusItemView({ item }: { item: StatusItem }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500 py-0.5">
      <Loader2 className="h-3 w-3 animate-spin shrink-0 text-slate-500" />
      <span>{item.message}</span>
    </div>
  );
}
