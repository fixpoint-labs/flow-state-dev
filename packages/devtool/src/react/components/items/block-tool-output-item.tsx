/**
 * Tier 2: Collapsible tool output for blocks executed within a generator.
 * Shows "▸ toolName(arg preview)" collapsed, full JSON on expand.
 * Failed tool calls show error details with red styling.
 */
import { useState } from "react";
import type { ToolOutputItem } from "@flow-state-dev/core/items";
import { AlertTriangle, Braces, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { JsonViewer } from "../shared/json-viewer";
import { safeParseJson, errorSummary } from "../../lib/utils";

export function ToolOutputItemView({ item }: { item: ToolOutputItem }) {
  const [expanded, setExpanded] = useState(false);
  const isInProgress = item.status === "in_progress";
  const isFailed = item.status === "failed";
  const failedSummary = isFailed ? errorSummary(item.error?.details) : undefined;
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
        {isFailed
          ? <AlertTriangle className="h-3 w-3 shrink-0 text-red-400" />
          : <Braces className="h-3 w-3 shrink-0 text-purple-400" />
        }
        <span className={`font-mono ${isFailed ? "text-red-300" : "text-purple-300"}`}>{item.toolCall.name}</span>
        {isFailed
          ? <span className="text-red-400/70 font-mono truncate">
              failed{failedSummary ? ` · ${failedSummary}` : ""}
            </span>
          : <span className="text-slate-500 font-mono truncate">({truncatedArgs})</span>
        }
        {item.cached === true && (
          // FIX-610: cache-hit badge. Hovering surfaces the age and
          // (when the hit crossed a task boundary inside a Task Board
          // run) the originating taskId so reviewers can trace the
          // reuse without expanding the row.
          <span
            className="px-1 rounded text-[10px] uppercase font-mono text-emerald-300 bg-emerald-900/40 shrink-0"
            title={renderCachedTitle(item.cacheAgeMs, item.sourceTask)}
          >
            cached
          </span>
        )}
        {item.sourceTask !== undefined && (
          <span
            className="text-[10px] font-mono text-slate-400 truncate"
            title={`Inherited from task ${item.sourceTask.taskId}`}
          >
            ← {item.sourceTask.taskId}
          </span>
        )}
        {isInProgress && <Loader2 className="h-3 w-3 animate-spin text-amber-400 shrink-0" />}
      </button>

      {expanded && (
        <div className="ml-7 mt-1.5 space-y-2">
          {isFailed && item.error && (
            <div>
              <span className="text-[10px] uppercase text-red-400 font-medium">Error</span>
              <div className="mt-0.5 text-xs text-red-300/90 bg-red-950/30 rounded px-2 py-1.5 font-mono">
                {item.error.message}
                {item.error.code && (
                  <span className="text-red-400/60 ml-2">[{item.error.code}]</span>
                )}
              </div>
            </div>
          )}
          <div>
            <span className="text-[10px] uppercase text-slate-500 font-medium">Arguments</span>
            <JsonViewer data={safeParseJson(item.toolCall.arguments)} className="mt-0.5" />
          </div>
          {!isInProgress && !isFailed && item.output !== undefined && (
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

function renderCachedTitle(
  ageMs: number | undefined,
  sourceTask: { collectionId: string; taskId: string } | undefined,
): string {
  const parts: string[] = ["served from cache"];
  if (typeof ageMs === "number") {
    parts.push(`age ${Math.max(0, Math.round(ageMs / 100) / 10)}s`);
  }
  if (sourceTask !== undefined) {
    parts.push(`from task ${sourceTask.taskId}`);
  }
  return parts.join(" — ");
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
