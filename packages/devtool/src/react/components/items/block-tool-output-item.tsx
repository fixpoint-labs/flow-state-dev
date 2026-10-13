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
          ? <ChevronDown className="h-3 w-3 shrink-0 text-fs-ink3" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-fs-ink3" />
        }
        {isFailed
          ? <AlertTriangle className="h-3 w-3 shrink-0 text-fs-red" />
          : <Braces className="h-3 w-3 shrink-0 text-fs-ink3" />
        }
        <span className={`font-fs-mono font-medium ${isFailed ? "text-fs-red" : "text-fs-ink"}`}>{item.toolCall.name}</span>
        {isFailed
          ? <span className="text-fs-red font-fs-mono truncate">
              failed{failedSummary ? ` · ${failedSummary}` : ""}
            </span>
          : <span className="text-fs-ink4 font-fs-mono truncate">({truncatedArgs})</span>
        }
        {item.cached === true && (
          // FIX-610: cache-hit badge. Hovering surfaces the age and
          // (when the hit crossed a task boundary inside a Task Board
          // run) the originating taskId so reviewers can trace the
          // reuse without expanding the row.
          <span
            className="px-1 border border-fs-green text-[9.5px] uppercase tracking-[.08em] font-fs-mono text-fs-green shrink-0"
            title={renderCachedTitle(item.cacheAgeMs, item.sourceTask)}
          >
            cached
          </span>
        )}
        {item.sourceTask !== undefined && (
          <span
            className="text-[10.5px] font-fs-mono text-fs-ink4 truncate"
            title={`Inherited from task ${item.sourceTask.taskId}`}
          >
            ← {item.sourceTask.taskId}
          </span>
        )}
        {isInProgress && <Loader2 className="h-3 w-3 animate-spin text-fs-blue shrink-0" />}
      </button>

      {expanded && (
        <div className="ml-7 mt-1.5 space-y-2">
          {isFailed && item.error && (
            <div>
              <span className="font-fs-mono text-[10px] font-medium uppercase tracking-[.14em] text-fs-red">Error</span>
              <div className="mt-0.5 text-xs text-fs-red bg-fs-card border border-fs-red px-2 py-1.5 font-fs-mono">
                {item.error.message}
                {item.error.code && (
                  <span className="text-fs-ink4 ml-2">[{item.error.code}]</span>
                )}
              </div>
            </div>
          )}
          <div>
            <span className="font-fs-mono text-[10px] font-medium uppercase tracking-[.14em] text-fs-ink3">Arguments</span>
            <JsonViewer data={safeParseJson(item.toolCall.arguments)} className="mt-0.5" />
          </div>
          {!isInProgress && !isFailed && item.output !== undefined && (
            <div>
              <span className="font-fs-mono text-[10px] font-medium uppercase tracking-[.14em] text-fs-ink3">Output</span>
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
