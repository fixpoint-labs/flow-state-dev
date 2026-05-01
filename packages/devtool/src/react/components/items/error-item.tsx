/**
 * Tier 1 error display: inline red banner with message.
 * Error code is shown on expand (via sidebar click).
 */
import { useState } from "react";
import type { ErrorItem } from "@flow-state-dev/core/items";
import { AlertCircle, ChevronDown, ChevronRight } from "lucide-react";

export function ErrorItemView({ item }: { item: ErrorItem }) {
  const [expanded, setExpanded] = useState(false);
  const hasCode = !!item.code;

  return (
    <div className="rounded-lg bg-red-950/40 border border-red-900/40 px-3 py-2">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-red-300 leading-relaxed">{item.message}</p>
          {hasCode && (
            <button
              className="mt-1 flex items-center gap-1 text-[11px] text-red-500 hover:text-red-400"
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Error code
            </button>
          )}
          {expanded && (
            <span className="mt-1 block text-xs font-mono text-red-500/80">{item.code}</span>
          )}
        </div>
      </div>
    </div>
  );
}
