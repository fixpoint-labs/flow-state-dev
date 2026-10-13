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

  // Only the figures the aggregate actually carries: cache cells appear when
  // the providers reported them, so the strip is 3-up, 4-up or 5-up.
  const stats: Array<{ label: string; value: string; primary?: boolean }> = [
    { label: "total", value: formatTokenCount(summary.totalTokens), primary: true },
    { label: "input", value: formatTokenCount(summary.promptTokens) },
    { label: "output", value: formatTokenCount(summary.completionTokens) },
  ];
  if (summary.cacheReadTokens > 0) {
    stats.push({ label: "cache r", value: formatTokenCount(summary.cacheReadTokens) });
  }
  if (summary.cacheCreationTokens > 0) {
    stats.push({ label: "cache w", value: formatTokenCount(summary.cacheCreationTokens) });
  }

  return (
    <div className="text-xs">
      <div className="mb-2.5 flex items-center justify-between font-fs-mono text-[10px] font-medium uppercase tracking-[.14em] text-fs-ink3">
        <span>Token Usage</span>
        <span>
          {summary.calls} {summary.calls === 1 ? "call" : "calls"}
        </span>
      </div>

      <div
        className="grid border-y border-fs-ink/30 font-fs-mono"
        style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
      >
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className={i === 0 ? "py-2" : "border-l border-fs-ink/15 py-2 pl-2.5"}
          >
            <div
              className={`truncate text-[18px] leading-tight tracking-[-.02em] tabular-nums text-fs-ink ${
                stat.primary ? "font-semibold" : "font-medium"
              }`}
            >
              {stat.value}
            </div>
            <div className="truncate text-[10.5px] text-fs-ink3">{stat.label}</div>
          </div>
        ))}
      </div>

      {summary.byModel.length > 1 && (
        <ModelBreakdown models={summary.byModel} />
      )}

      {summary.byModel.length === 1 && (
        <div className="mt-2.5 truncate font-fs-mono text-[10.5px] text-fs-ink4">
          {summary.byModel[0].model}
        </div>
      )}
    </div>
  );
}

function ModelBreakdown({ models }: { models: TokenSummary["byModel"] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2.5">
      <button
        className="flex w-full items-center gap-1.5 text-left font-fs-mono text-[10.5px] font-medium uppercase tracking-[.1em] text-fs-ink3 hover:text-fs-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fs-blue/40"
        onClick={() => setOpen(!open)}
      >
        {open
          ? <ChevronDown className="h-3 w-3" />
          : <ChevronRight className="h-3 w-3" />}
        <span>Per Model</span>
        <span className="text-fs-ink4">{models.length}</span>
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col">
          {models.map((m) => (
            <div key={m.model} className="border-t border-fs-ink/10 py-1.5 pl-4 font-fs-mono">
              <div className="grid grid-cols-[minmax(0,1fr)_56px_48px] text-[11.5px] font-medium">
                <span className="truncate text-fs-ink">{m.model}</span>
                <span className="text-fs-ink3">
                  {m.calls} {m.calls === 1 ? "call" : "calls"}
                </span>
                <span className="text-right tabular-nums text-fs-ink">{formatTokenCount(m.totalTokens)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10.5px] text-fs-ink4">
                <span>in {formatTokenCount(m.promptTokens)}</span>
                <span>out {formatTokenCount(m.completionTokens)}</span>
                {m.cacheReadTokens > 0 && (
                  <span>cache r {formatTokenCount(m.cacheReadTokens)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
