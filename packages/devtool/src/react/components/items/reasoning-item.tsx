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
        className="flex items-center gap-1.5 w-full text-left text-xs text-fs-ink3 hover:text-fs-ink"
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
      >
        {expanded
          ? <ChevronDown className="h-3 w-3 shrink-0 text-fs-ink3" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-fs-ink3" />
        }
        <Brain className="h-3 w-3 shrink-0 text-fs-ink3" />
        <span className="font-fs-mono font-medium">Reasoning</span>
        {lineCount > 0 && <span className="font-fs-mono text-fs-ink4">({lineCount} {lineCount === 1 ? "line" : "lines"})</span>}
      </button>
      {expanded && (
        <div className="ml-7 mt-1.5 border-l border-fs-ink/20 pl-3 text-[13px] text-fs-ink2 whitespace-pre-wrap leading-relaxed">
          {text || <span className="italic text-fs-ink4">No reasoning content</span>}
        </div>
      )}
    </div>
  );
}
