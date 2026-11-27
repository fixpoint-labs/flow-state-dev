/**
 * Tier 2: a data record (`ctx.emit.data`), collapsed to its `dataType` and
 * expandable to its `value` JSON. The devtool sees every record, whatever its
 * client visibility.
 */
import { useState } from "react";
import type { DataItem } from "@flow-state-dev/core/items";
import { Database, ChevronDown, ChevronRight } from "lucide-react";
import { JsonViewer } from "../shared/json-viewer";

export function DataItemView({ item }: { item: DataItem }) {
  const [expanded, setExpanded] = useState(false);
  const hasValue = Object.keys(item.value).length > 0;

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
        <Database className="h-3 w-3 shrink-0 text-fs-ink3" />
        <span className="font-fs-mono font-medium text-fs-ink">{item.dataType}</span>
      </button>
      {expanded && hasValue && (
        <div className="ml-7 mt-1.5">
          <JsonViewer data={item.value} className="mt-0.5" />
        </div>
      )}
    </div>
  );
}
