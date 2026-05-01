/**
 * Tier 2: Collapsed reasoning summary, expandable to full text.
 * Shows "▸ Reasoning (N lines)" when collapsed.
 */
import { useState } from "react";
import type { ReasoningItem } from "@flow-state-dev/core/items";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";

export function ReasoningItemView({ item }: { item: ReasoningItem }) {
  const [expanded, setExpanded] = useState(false);
  const text = item.summary
    .map((c) => ("text" in c ? (c as { text: string }).text : ""))
    .join("");
  const lineCount = text ? text.split("\n").filter(Boolean).length : 0;

  return (
    <div>
      <button
        className="flex items-center gap-1.5 w-full text-left text-xs text-slate-400"
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
      >
        {expanded
          ? <ChevronDown className="h-3 w-3 shrink-0 text-slate-500" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" />
        }
        <Brain className="h-3 w-3 shrink-0 text-slate-400" />
        <span>Reasoning</span>
        {lineCount > 0 && <span className="text-slate-600">({lineCount} {lineCount === 1 ? "line" : "lines"})</span>}
      </button>
      {expanded && (
        <div className="ml-7 mt-1.5 text-xs text-slate-400 whitespace-pre-wrap leading-relaxed">
          {text || <span className="italic text-slate-600">No reasoning content</span>}
        </div>
      )}
    </div>
  );
}
