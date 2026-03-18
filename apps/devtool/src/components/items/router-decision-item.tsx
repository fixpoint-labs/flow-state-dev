/**
 * Tier 2: Router decision display.
 * Shows which route was selected by a router block.
 */
import type { RouterDecisionItem } from "@flow-state-dev/core/items";
import { GitBranch } from "lucide-react";

export function RouterDecisionItemView({ item }: { item: RouterDecisionItem }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <GitBranch className="h-3 w-3 shrink-0 text-orange-400" />
      <span className="font-mono text-slate-300">{item.routerName}</span>
      <span className="text-slate-600">→</span>
      <span className="text-orange-300">{item.selectedRoute}</span>
    </div>
  );
}
