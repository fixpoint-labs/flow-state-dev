/**
 * Tier 2: Collapsed component identifier, expandable to data/props JSON.
 */
import { useState } from "react";
import type { ComponentItem } from "@flow-state-dev/core/items";
import { Puzzle, ChevronDown, ChevronRight } from "lucide-react";
import { JsonViewer } from "../shared/json-viewer";

export function ComponentItemView({ item }: { item: ComponentItem }) {
  const [expanded, setExpanded] = useState(false);
  const hasData = Object.keys(item.data).length > 0;

  return (
    <div>
      <button
        className="flex items-center gap-1.5 w-full text-left text-xs"
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
      >
        {expanded
          ? <ChevronDown className="h-3 w-3 shrink-0 text-fs-ink3" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-fs-ink3" />
        }
        <Puzzle className="h-3 w-3 shrink-0 text-fs-ink3" />
        <span className="font-fs-mono font-medium text-fs-ink">{item.component}</span>
      </button>
      {expanded && hasData && (
        <div className="ml-7 mt-1.5">
          <JsonViewer data={item.data} className="mt-0.5" />
        </div>
      )}
    </div>
  );
}
