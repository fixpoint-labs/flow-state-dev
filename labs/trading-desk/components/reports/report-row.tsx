/**
 * ReportRow — one clickable Past Reports list entry.
 *
 * Renders a single `ReportRow` (parsed from a `SessionSummary` via
 * `parseReportRow`) as a focusable `<button>`. The row degrades gracefully
 * across every lifecycle the parser produces:
 *
 *   - `complete` → ticker + as-of date, a rating·conviction decision chip
 *     color-keyed to the 5-tier scale, the truncated PM summary subtitle.
 *   - `stopped`  → a warn chip and a generic "Halted before a decision." line
 *     (the specific reason lives in session state, shown only on open).
 *   - `in-progress` → a neutral pulsing chip, no subtitle.
 *   - legacy / malformed decision → an em-dash chip, tuple-derived title only.
 *
 * Colors reuse the OKLCH `--c-*` tokens already in the app; no new chart or
 * date dependency. Relative time is formatted inline (`relativeTime`).
 */
"use client";

import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import {
  relativeTime,
  type ReportRow as ReportRowData,
} from "@/src/flows/analysis/report-index";

/** Map a 5-tier rating to a token-backed color. Buy/Overweight lean to the
 *  live (green) token, Sell/Underweight to warn, Hold stays neutral — the same
 *  directional reading the PM hero's rating bar implies, expressed as a chip. */
function ratingColor(finalRating: string): string {
  switch (finalRating) {
    case "Buy":
    case "Overweight":
      return "var(--c-live)";
    case "Sell":
    case "Underweight":
      return "var(--c-warn)";
    default:
      return "var(--c-fg-muted)";
  }
}

function DecisionChip({ row }: { row: ReportRowData }): ReactElement {
  if (row.status === "stopped") {
    return (
      <span
        className="font-mono text-[11px] uppercase tracking-wider"
        style={{ color: "var(--c-warn)" }}
      >
        stopped
      </span>
    );
  }
  if (row.decision === null) {
    // in-progress or legacy / malformed: neutral, no fabricated rating.
    return row.status === "in-progress" ? (
      <span
        className="td-pulse font-mono text-[11px] text-[color:var(--c-fg-muted)]"
        aria-label="in progress"
      >
        in-progress…
      </span>
    ) : (
      <span className="font-mono text-[11px] text-[color:var(--c-fg-faint)]">—</span>
    );
  }
  return (
    <span
      className="font-mono text-[11px] font-medium"
      style={{ color: ratingColor(row.decision.finalRating) }}
    >
      {row.decision.finalRating}
      <span className="text-[color:var(--c-fg-faint)]">
        {" · "}
        {row.decision.decisionConfidence.toFixed(2)}
      </span>
    </span>
  );
}

function subtitleFor(row: ReportRowData): string | null {
  if (row.decision !== null) return row.decision.summary;
  if (row.status === "stopped") return "Halted before a decision.";
  return null;
}

export function ReportRow({
  row,
  onOpen,
}: {
  row: ReportRowData;
  onOpen: (id: string) => void;
}): ReactElement {
  const subtitle = subtitleFor(row);
  // Record runs style as live — they carry live-fetched data.
  const isLive = row.dataSource !== "fixture";
  return (
    <button
      type="button"
      onClick={() => onOpen(row.id)}
      className={cn(
        "flex w-full flex-col gap-1 px-4 py-3 text-left",
        "hover:bg-[color:var(--c-surface-2)]",
        "focus:outline-none focus:bg-[color:var(--c-surface-2)]",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-[13px] font-semibold text-[color:var(--c-fg)]">
          {row.ticker}
        </span>
        <span className="text-[11px] text-[color:var(--c-fg-faint)]">
          {row.asOfDate}
        </span>
        <span className="flex-1" />
        <DecisionChip row={row} />
        <span className="text-[color:var(--c-fg-faint)]">·</span>
        <span className="text-[10.5px] text-[color:var(--c-fg-muted)]">
          {relativeTime(row.sortKey)}
        </span>
        {row.costPreset.length > 0 ? (
          <span className="font-mono text-[10.5px] text-[color:var(--c-fg-faint)]">
            {row.costPreset}
          </span>
        ) : null}
        {row.dataSource.length > 0 ? (
          <span
            aria-label={isLive ? "live data" : "fixture data"}
            title={isLive ? "live" : "fixture"}
            className="inline-block h-2 w-2 rounded-full"
            style={{
              background: isLive ? "var(--c-live)" : "transparent",
              border: isLive
                ? "none"
                : "1px solid var(--c-fixture)",
            }}
          />
        ) : null}
      </div>
      {subtitle !== null ? (
        <p className="line-clamp-1 text-[11.5px] leading-relaxed text-[color:var(--c-fg-muted)]">
          {subtitle}
        </p>
      ) : null}
    </button>
  );
}
