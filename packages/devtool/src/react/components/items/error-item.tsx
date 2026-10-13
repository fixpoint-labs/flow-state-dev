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
    <div className="border border-fs-red bg-fs-card px-3 py-2">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 text-fs-red mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] text-fs-red leading-relaxed">{item.message}</p>
          {hasCode && (
            <button
              className="mt-1 flex items-center gap-1 font-fs-mono text-[11px] text-fs-ink3 hover:text-fs-ink"
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Error code
            </button>
          )}
          {expanded && (
            <span className="mt-1 block text-xs font-fs-mono text-fs-ink2">{item.code}</span>
          )}
        </div>
      </div>
    </div>
  );
}
