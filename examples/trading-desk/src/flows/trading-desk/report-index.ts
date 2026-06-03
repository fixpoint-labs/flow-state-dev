/**
 * Pure, browser-safe schemas and parse helper for the Past Reports index.
 *
 * The reports "index" is not a separate store — it is the session list
 * (`listSessions`), and each row's display fields ride in the session's
 * `metadata` bag. This module defines a typed view of that bag plus a
 * tolerant `parseReportRow` that turns a `SessionSummary` into a render-ready
 * `ReportRow`, degrading gracefully on legacy / in-progress / malformed
 * metadata.
 *
 * Import-safe in the browser: zod + plain types only. No
 * `@flow-state-dev/core` resource imports, no Node-only model resolvers. The
 * decision-snapshot resource (the heavy, scoreable record) lives in the
 * sibling `decision-snapshot-resource.ts` and is never imported from here.
 */
import { z } from "zod";

/**
 * The decision summary merged into session metadata at PM-commit so the Past
 * Reports list can render rich rows from `listSessions` alone — no per-session
 * state load. Additive: the four tuple keys (ticker/date/costPreset/dataSource)
 * written at session-create time are untouched by the merge.
 */
export const reportDecisionMetaSchema = z.object({
  finalRating: z.enum(["Sell", "Underweight", "Hold", "Overweight", "Buy"]),
  decisionConfidence: z.number().min(0).max(1),
  /** One-line PM TLDR for the list subtitle. Truncated to a sane length at
   *  write time (see the PM commit handler). */
  summary: z.string(),
  /** ISO timestamp the decision committed. Distinct from `session.createdAt`,
   *  which is when the tuple was first created — a re-run reuses the session. */
  decidedAt: z.string(),
});
export type ReportDecisionMeta = z.infer<typeof reportDecisionMetaSchema>;

/**
 * Coarse lifecycle for a report row, so the list can badge in-progress /
 * stopped runs distinctly from completed ones. The absence of the key on a
 * session's metadata means `in-progress` (legacy and brand-new sessions both
 * fall through to it cleanly).
 */
export const reportStatusMetaSchema = z.enum([
  "complete", // PM published
  "stopped", // a guard tripped (unresolvable ticker / no data)
  "in-progress", // created/streaming, no terminal decision yet
]);
export type ReportStatusMeta = z.infer<typeof reportStatusMetaSchema>;

/**
 * The minimal `SessionSummary` shape this parser reads. Kept local (rather
 * than imported from `@flow-state-dev/client`) so this module stays a pure
 * leaf with no client-package dependency — the UI layer passes the full
 * `SessionSummary`, which structurally satisfies this.
 */
export type ReportSessionSummary = {
  id: string;
  title?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
};

/** A render-ready Past Reports row, derived from one `SessionSummary`. */
export type ReportRow = {
  id: string;
  /** From `metadata.ticker`; `"—"` when absent (defensive). */
  ticker: string;
  /** From `metadata.date`; empty string when absent. */
  asOfDate: string;
  /** From `metadata.costPreset`; empty string when absent. */
  costPreset: string;
  /** From `metadata.dataSource`; empty string when absent. */
  dataSource: string;
  /** `summary.title` when present, else built from the tuple. */
  title: string;
  /** `metadata.reportStatus`, safe-parsed; `"in-progress"` on absence. */
  status: ReportStatusMeta;
  /** Safe-parsed `metadata.decision`; `null` on legacy / in-progress /
   *  malformed metadata (never throws). */
  decision: ReportDecisionMeta | null;
  createdAt: number;
  /** Newest-first sort key: the decision time when complete, else
   *  `createdAt`. */
  sortKey: number;
};

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** Build the auto-derived title from the tuple when a session has no stored
 *  title (middle-dot separator, matching the app's `titleForTuple`). */
function titleFromTuple(
  ticker: string,
  asOfDate: string,
  costPreset: string,
  dataSource: string,
): string {
  return [ticker, asOfDate, costPreset, dataSource]
    .filter((part) => part.length > 0)
    .join(" · ");
}

/**
 * Parse a `SessionSummary` into a render-ready `ReportRow`.
 *
 * Tolerant by contract: legacy rows (no `decision`/`reportStatus`), in-progress
 * rows, and malformed `decision` blobs all degrade to a tuple-only row with
 * `decision: null` rather than throwing. This is the robustness guarantee the
 * list depends on — one bad metadata bag must never crash the whole list.
 */
export function parseReportRow(summary: ReportSessionSummary): ReportRow {
  const metadata = summary.metadata ?? {};

  const ticker = asString(metadata.ticker, "—");
  const asOfDate = asString(metadata.date, "");
  const costPreset = asString(metadata.costPreset, "");
  const dataSource = asString(metadata.dataSource, "");

  const decisionParsed = reportDecisionMetaSchema.safeParse(metadata.decision);
  const decision = decisionParsed.success ? decisionParsed.data : null;

  const statusParsed = reportStatusMetaSchema.safeParse(metadata.reportStatus);
  const status: ReportStatusMeta = statusParsed.success
    ? statusParsed.data
    : "in-progress";

  const title = asString(
    summary.title,
    titleFromTuple(ticker, asOfDate, costPreset, dataSource),
  );

  const decidedAtMs = decision ? Date.parse(decision.decidedAt) : Number.NaN;
  const sortKey = Number.isNaN(decidedAtMs) ? summary.createdAt : decidedAtMs;

  return {
    id: summary.id,
    ticker,
    asOfDate,
    costPreset,
    dataSource,
    title,
    status,
    decision,
    createdAt: summary.createdAt,
    sortKey,
  };
}

/**
 * The four-field run tuple a row maps to. This is the same shape the header
 * inputs and `findSessionForTuple` key on — re-opening a report sets the header
 * to this tuple BEFORE selecting the session so the tuple-sync effect is a
 * no-op (see the Past Reports open-report fix). The values are the raw parsed
 * strings; the caller narrows `costPreset`/`dataSource` to the input unions.
 */
export type ReportRowTuple = {
  ticker: string;
  date: string;
  costPreset: string;
  dataSource: string;
};

/** Extract the run tuple from a parsed row. Pure — used by the open-report
 *  handler to align the header inputs with the report being opened. */
export function reportRowTuple(row: ReportRow): ReportRowTuple {
  return {
    ticker: row.ticker,
    date: row.asOfDate,
    costPreset: row.costPreset,
    dataSource: row.dataSource,
  };
}

/**
 * Render a millisecond timestamp as a short relative string (`"just now"`,
 * `"3m ago"`, `"2h ago"`, `"yesterday"`, `"4d ago"`), falling back to the ISO
 * date for anything older than a week. Inline so the example pulls no date
 * library for one list column. `future` timestamps (clock skew) read
 * `"just now"`.
 */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const delta = now - ms;
  if (!Number.isFinite(delta) || delta < 45_000) return "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(delta / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(delta / 86_400_000);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}
