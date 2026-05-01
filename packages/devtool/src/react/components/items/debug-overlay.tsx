import { useState } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { ChevronDown, ChevronRight } from "lucide-react";

export function DebugOverlay({ item }: { item: OutputItem }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-1 border-t border-slate-800/50 pt-1">
      <button
        className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-400"
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
      >
        {expanded ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
        Raw JSON
      </button>
      {expanded && (
        <pre className="mt-1 text-[10px] text-slate-600 font-mono whitespace-pre-wrap overflow-auto max-h-48 bg-slate-950 rounded p-2">
          {JSON.stringify(item, null, 2)}
        </pre>
      )}
    </div>
  );
}
