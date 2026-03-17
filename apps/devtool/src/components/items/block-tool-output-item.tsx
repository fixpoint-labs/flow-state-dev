/**
 * Tier 2: Collapsible tool output for blocks executed within a generator.
 * Shows "▸ toolName(arg preview)" collapsed, full JSON on expand.
 */
import { useState } from "react";
import type { BlockToolOutputItem } from "@flow-state-dev/core/items";
import { Braces, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { JsonViewer } from "@/components/shared/json-viewer";

export function BlockToolOutputItemView({ item }: { item: BlockToolOutputItem }) {
  const [expanded, setExpanded] = useState(false);
  const isInProgress = item.status === "in_progress";
  const truncatedArgs = formatToolArgs(item.toolCall.arguments);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <div>
      <button
        className="flex items-center gap-1.5 w-full text-left text-xs group/tool"
        onClick={toggle}
      >
        {expanded
          ? <ChevronDown className="h-3 w-3 shrink-0 text-slate-500" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" />
        }
        <Braces className="h-3 w-3 shrink-0 text-purple-400" />
        <span className="font-mono text-purple-300">{item.toolCall.name}</span>
        <span className="text-slate-500 font-mono truncate">({truncatedArgs})</span>
        {isInProgress && <Loader2 className="h-3 w-3 animate-spin text-amber-400 shrink-0" />}
      </button>

      {expanded && (
        <div className="ml-7 mt-1.5 space-y-2">
          <div>
            <span className="text-[10px] uppercase text-slate-500 font-medium">Arguments</span>
            <JsonViewer data={safeParseJson(item.toolCall.arguments)} className="mt-0.5" />
          </div>
          {!isInProgress && item.output !== undefined && (
            <div>
              <span className="text-[10px] uppercase text-slate-500 font-medium">Output</span>
              <JsonViewer data={item.output} className="mt-0.5" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatToolArgs(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const keys = Object.keys(parsed);
      const preview = keys.slice(0, 3).map((k) => {
        const v = parsed[k];
        if (typeof v === "string") return `${k}: "${v.length > 20 ? v.slice(0, 20) + "…" : v}"`;
        return `${k}: ${JSON.stringify(v)}`;
      });
      if (keys.length > 3) preview.push("…");
      return preview.join(", ");
    }
  } catch {
    // fall through
  }
  return raw.length > 60 ? raw.slice(0, 60) + "…" : raw;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
