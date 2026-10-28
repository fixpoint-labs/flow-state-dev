/**
 * Tier 2: Router decision display.
 * Shows which route was selected by a router block.
 */
import type { RouterDecisionItem } from "@flow-state-dev/core/items";
import { GitBranch } from "lucide-react";

export function RouterDecisionItemView({ item }: { item: RouterDecisionItem }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <GitBranch className="h-3 w-3 shrink-0 text-fs-ink3" />
      <span className="font-fs-mono text-fs-ink2">{item.routerName}</span>
      <span className="text-fs-ink4">→</span>
      <span className="font-fs-mono font-medium text-fs-ink">{item.selectedRoute}</span>
    </div>
  );
}
