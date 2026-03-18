/**
 * Tier 2: Collapsed step error with recovery status. Expandable to full message.
 */
import { useState } from "react";
import type { StepErrorItem } from "@flow-state-dev/core/items";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";

export function StepErrorItemView({ item }: { item: StepErrorItem }) {
  const [expanded, setExpanded] = useState(false);
  const blockLabel = item.blockName ? ` in ${item.blockName}` : "";
  const recoveryLabel = item.recovered ? "recovered" : "unrecovered";

  return (
    <div>
      <button
        className="flex items-center gap-1.5 w-full text-left text-xs"
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
      >
        {expanded
          ? <ChevronDown className="h-3 w-3 shrink-0 text-slate-500" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" />
        }
        <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
        <span className="text-amber-400">Step error{blockLabel}</span>
        <span className="text-slate-600">— {recoveryLabel}</span>
      </button>
      {expanded && (
        <div className="ml-7 mt-1.5 space-y-1">
          <p className="text-xs text-amber-300/80 leading-relaxed">{item.message}</p>
          {item.code && (
            <span className="text-[10px] font-mono text-amber-600">{item.code}</span>
          )}
        </div>
      )}
    </div>
  );
}
