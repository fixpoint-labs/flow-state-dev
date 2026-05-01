/**
 * Tier 3 (debug-only): LLM context. Shown as muted single-line indicator.
 */
import { useState } from "react";
import type { ContextItem } from "@flow-state-dev/core/items";
import { Eye, ChevronDown, ChevronRight } from "lucide-react";

export function ContextItemView({ item }: { item: ContextItem }) {
  const [expanded, setExpanded] = useState(false);
  const preview = item.text.length > 80 ? item.text.slice(0, 80) + "…" : item.text;

  return (
    <div>
      <button
        className="flex items-center gap-1.5 w-full text-left text-[11px] text-slate-600"
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
      >
        {expanded
          ? <ChevronDown className="h-2.5 w-2.5 shrink-0" />
          : <ChevronRight className="h-2.5 w-2.5 shrink-0" />
        }
        <Eye className="h-2.5 w-2.5 shrink-0" />
        <span className="truncate">{expanded ? "Context" : preview}</span>
      </button>
      {expanded && (
        <div className="ml-6 mt-1 text-[11px] text-slate-600 whitespace-pre-wrap max-h-40 overflow-auto">
          {item.text}
        </div>
      )}
    </div>
  );
}
