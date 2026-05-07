/**
 * Session-level token usage summary.
 *
 * Aggregates modelUsage from all BlockTraceItems across all request groups
 * in the current session. Shows totals and per-model breakdowns.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { RequestGroup } from "../workspace/stream-view";
import { aggregateTokenUsage, formatTokenCount, type TokenSummary } from "../../lib/token-utils";

type TokenUsageSummaryProps = {
  requestGroups: RequestGroup[];
};

export function TokenUsageSummary({ requestGroups }: TokenUsageSummaryProps) {
  const summary = useMemo<TokenSummary>(() => {
    const allItems = requestGroups.flatMap((g) => g.items);
    return aggregateTokenUsage(allItems);
  }, [requestGroups]);

  if (summary.calls === 0) return null;

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase text-slate-500">Token Usage</span>
        <span className="text-[10px] font-mono text-slate-600">
          {summary.calls} {summary.calls === 1 ? "call" : "calls"}
        </span>
      </div>

      <div className="space-y-1">
        <MetadataRow label="Total" value={formatTokenCount(summary.totalTokens)} highlight />
        <MetadataRow label="Prompt" value={formatTokenCount(summary.promptTokens)} />
        <MetadataRow label="Completion" value={formatTokenCount(summary.completionTokens)} />
        {summary.cacheReadTokens > 0 && (
          <MetadataRow label="Cache read" value={formatTokenCount(summary.cacheReadTokens)} />
        )}
        {summary.cacheCreationTokens > 0 && (
          <MetadataRow label="Cache write" value={formatTokenCount(summary.cacheCreationTokens)} />
        )}
      </div>

      {summary.byModel.length > 1 && (
        <ModelBreakdown models={summary.byModel} />
      )}

      {summary.byModel.length === 1 && (
        <div className="text-[10px] font-mono text-slate-600 truncate">
          {summary.byModel[0].model}
        </div>
      )}
    </div>
  );
}

function ModelBreakdown({ models }: { models: TokenSummary["byModel"] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        className="flex items-center gap-1 w-full text-left py-0.5"
        onClick={() => setOpen(!open)}
      >
        {open
          ? <ChevronDown className="h-3 w-3 text-slate-500" />
          : <ChevronRight className="h-3 w-3 text-slate-500" />}
        <span className="text-[10px] font-medium uppercase text-slate-500">Per Model</span>
        <span className="text-[10px] font-mono text-slate-600 bg-slate-800/60 px-1.5 rounded-full">
          {models.length}
        </span>
      </button>
      {open && (
        <div className="pl-4 mt-0.5 space-y-2">
          {models.map((m) => (
            <div key={m.model} className="space-y-0.5">
              <div className="text-[10px] font-mono text-slate-400 truncate">{m.model}</div>
              <div className="pl-2 space-y-0.5">
                <MetadataRow label="Total" value={formatTokenCount(m.totalTokens)} />
                <MetadataRow label="Prompt" value={formatTokenCount(m.promptTokens)} />
                <MetadataRow label="Completion" value={formatTokenCount(m.completionTokens)} />
                {m.cacheReadTokens > 0 && (
                  <MetadataRow label="Cache read" value={formatTokenCount(m.cacheReadTokens)} />
                )}
                <div className="text-[10px] text-slate-600">
                  {m.calls} {m.calls === 1 ? "call" : "calls"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetadataRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono tabular-nums ${highlight ? "text-slate-200" : "text-slate-400"}`}>
        {value}
      </span>
    </div>
  );
}
