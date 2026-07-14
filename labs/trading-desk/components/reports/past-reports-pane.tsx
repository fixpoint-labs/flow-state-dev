/**
 * PastReportsPane — the full-width Past Reports list surface.
 *
 * Reads the already-loaded session list (`flow.sessions`), maps each
 * `SessionSummary` through the pure `parseReportRow`, sorts newest-first by
 * `sortKey` (the decision time when complete, else `createdAt`), and renders a
 * `ReportRow` per session. Clicking a row calls `onOpenReport(id)`, which the
 * parent implements as "set header tuple → select session → switch to desk
 * view" (the tuple-sync fix lives in the parent, not here).
 *
 * This pane reads metadata only — no per-session state load — so the list is a
 * single `listSessions` read. Re-opening a row hydrates the stored report with
 * zero model spend; the list itself never dispatches a run.
 */
"use client";

import { useMemo, type ReactElement } from "react";
import type { SessionSummary } from "@flow-state-dev/client";
import { ReportRow } from "./report-row";
import {
  parseReportRow,
  type ReportRow as ReportRowData,
} from "@/flows/analysis/report-index";

type PastReportsPaneProps = {
  sessions: ReadonlyArray<SessionSummary>;
  onOpenReport: (id: string) => void;
};

export function PastReportsPane({
  sessions,
  onOpenReport,
}: PastReportsPaneProps): ReactElement {
  // Derived state (BP-010): parse + sort the session list into render-ready
  // rows. `parseReportRow` is pure and `flow.sessions` is the only input, so a
  // memo (not an effect) is correct. Newest-first by sortKey.
  const rows = useMemo<ReportRowData[]>(
    () =>
      sessions
        .map((s) => parseReportRow(s))
        .sort((a, b) => b.sortKey - a.sortKey),
    [sessions],
  );

  return (
    <section
      className="flex flex-1 flex-col overflow-y-auto bg-[color:var(--c-bg)]"
      aria-label="Past Reports"
    >
      <header className="flex items-baseline gap-3 px-4 pt-5 pb-3">
        <h1 className="text-[15px] font-semibold text-[color:var(--c-fg)]">
          Past Reports
        </h1>
        <span className="text-[11px] text-[color:var(--c-fg-faint)]">
          {rows.length} {rows.length === 1 ? "report" : "reports"} · you
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-[12px] text-[color:var(--c-fg-muted)]">
          No analyses yet. Run a ticker from the Desk to create your first
          report.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[color:var(--c-border)] border-t border-[color:var(--c-border)]">
          {rows.map((row) => (
            <li key={row.id}>
              <ReportRow row={row} onOpen={onOpenReport} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
