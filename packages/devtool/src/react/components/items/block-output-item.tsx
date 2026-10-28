/**
 * Tier 2: Collapsed single-line summary, expandable to full detail.
 *
 * Tool calls: "▸ toolName(arg1, arg2)" collapsed, full JSON on expand.
 * Regular outputs: "▸ blockName → completed" collapsed, full JSON on expand.
 */
import { useState } from "react";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import { Braces, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { JsonViewer } from "../shared/json-viewer";
import { BlockValueView } from "../shared/block-value-view";
import { safeParseJson, errorSummary } from "../../lib/utils";

export function BlockTraceItemView({ item }: { item: BlockTraceItem }) {
  const [expanded, setExpanded] = useState(false);
  const isToolCall = !!item.toolCall;
  const isInProgress = item.status === "in_progress";

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  if (isToolCall) {
    const truncatedArgs = formatToolArgs(item.toolCall!.arguments);

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
          <Braces className="h-3 w-3 shrink-0 text-fs-ink3" />
          <span className="font-fs-mono font-medium text-fs-ink">{item.blockName}</span>
          <span className="text-fs-ink4 font-fs-mono truncate">({truncatedArgs})</span>
          {isInProgress && <Loader2 className="h-3 w-3 animate-spin text-fs-blue shrink-0" />}
        </button>

        {expanded && (
          <div className="ml-7 mt-1.5 space-y-2">
            <div>
              <span className="font-fs-mono text-[10px] font-medium uppercase tracking-[.14em] text-fs-ink3">Arguments</span>
              <JsonViewer data={safeParseJson(item.toolCall!.arguments)} className="mt-0.5" />
            </div>
            {!isInProgress && item.output !== undefined && (
              <div>
                <span className="font-fs-mono text-[10px] font-medium uppercase tracking-[.14em] text-fs-ink3">Output</span>
                <BlockValueView value={item.output} />
              </div>
            )}
            {item.modelUsage && (
              <div className="flex items-center gap-3 text-[10.5px] text-fs-ink4 font-fs-mono">
                {item.modelUsage.model && <span>{item.modelUsage.model}</span>}
                {item.modelUsage.promptTokens !== undefined && <span>{item.modelUsage.promptTokens} in</span>}
                {item.modelUsage.completionTokens !== undefined && <span>{item.modelUsage.completionTokens} out</span>}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const statusLabel = item.status === "completed" ? "completed" : item.status === "in_progress" ? "running" : item.status;
  const failedMessage = item.status === "failed" ? item.error?.message : undefined;
  const failedSummary = item.status === "failed" ? errorSummary(item.error?.details) : undefined;

  return (
    <div>
      <button
        className="flex items-center gap-1.5 w-full text-left text-xs"
        onClick={toggle}
      >
        {expanded
          ? <ChevronDown className="h-3 w-3 shrink-0 text-fs-ink3" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-fs-ink3" />
        }
        <Braces className="h-3 w-3 shrink-0 text-fs-ink3" />
        <span className="font-fs-mono font-medium text-fs-ink">{item.blockName}</span>
        <span className="text-fs-ink4">→</span>
        <span className={`font-fs-mono ${item.status === "failed" ? "text-fs-red" : "text-fs-ink3"}`}>{statusLabel}</span>
        {failedSummary && (
          <span className="text-[9.5px] font-fs-mono px-1 py-0 border border-fs-red text-fs-red shrink-0">
            {failedSummary}
          </span>
        )}
        {failedMessage && (
          <span className="text-fs-red truncate max-w-[20rem]" title={failedMessage}>
            {failedMessage}
          </span>
        )}
        {isInProgress && <Loader2 className="h-3 w-3 animate-spin text-fs-blue shrink-0" />}
      </button>

      {expanded && (
        <div className="ml-7 mt-1.5 space-y-2">
          {item.status === "failed" && item.error && (
            <div>
              <span className="font-fs-mono text-[10px] font-medium uppercase tracking-[.14em] text-fs-red">Error</span>
              <p className="text-xs text-fs-red font-fs-mono mt-0.5">{item.error.message}</p>
              {item.error.code && (
                <p className="text-[10px] text-fs-ink4 font-fs-mono mt-0.5">{item.error.code}</p>
              )}
            </div>
          )}
          {item.output !== undefined && (
            <div>
              <span className="font-fs-mono text-[10px] font-medium uppercase tracking-[.14em] text-fs-ink3">Output</span>
              <BlockValueView value={item.output} />
            </div>
          )}
          {item.modelUsage && (
            <div className="flex items-center gap-3 text-[10.5px] text-fs-ink4 font-fs-mono">
              {item.modelUsage.model && <span>{item.modelUsage.model}</span>}
              {item.modelUsage.promptTokens !== undefined && <span>{item.modelUsage.promptTokens} in</span>}
              {item.modelUsage.completionTokens !== undefined && <span>{item.modelUsage.completionTokens} out</span>}
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
