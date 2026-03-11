import { useState } from "react";
import type { ReasoningItem } from "@flow-state-dev/core/items";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";

export function ReasoningItemView({ item }: { item: ReasoningItem }) {
  const [expanded, setExpanded] = useState(false);
  const text = item.summary
    .map((c) => ("text" in c ? (c as { text: string }).text : ""))
    .join("");

  return (
    <div className="rounded bg-slate-900/50 px-2 py-1.5">
      <button
        className="flex items-center gap-1.5 text-xs text-slate-400 w-full text-left"
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
      >
        <Brain className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Reasoning</span>
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="mt-1.5 text-xs text-slate-400 whitespace-pre-wrap pl-5">
          {text || <span className="italic">No reasoning content</span>}
        </div>
      )}
    </div>
  );
}
