/**
 * The error history as a worker reads it: a read-only projected collection,
 * `error-history/<YYYY-MM-DD>/<ref>`, one record per report per UTC day it
 * has an entry. Workers reach it with core's `searchResources` and
 * `readResourceContent`; there is no tool made for it.
 *
 * Nothing is stored here. Each `read` and `search` runs the reporter's history
 * read through its bound host, as the operator, and then filters by the
 * caller the framework hands the hook (`ctx.userId`, `ctx.orgId`, both
 * server-derived): the operator reads every report; another user of the
 * operator's org reads a report only through their own occurrences; anyone
 * else reads nothing, and `read` answers as it does for an unknown key. Search
 * words narrow only what the caller may read.
 */
import { defineProjectedResourceCollection } from "@flow-state-dev/core";
import { parseResourceTemplate } from "@flow-state-dev/core/resource-template";
import type { ProjectedResourceContext, ResourceQuery } from "@flow-state-dev/core/types";
import { z } from "zod";
import { HISTORY_RETENTION_DAYS, utcDay, type HistoryEntry } from "./history";
import type { ErrorReporter } from "./reporter";
import { statusInWords, type HistoryRead, type ReportResourceState } from "./reports";

/** The accessor a flow declares the history view under. */
export const ERROR_HISTORY_RESOURCE = "errorHistory";

/** The view's pattern, and the prefix its paths start with. */
const ERROR_HISTORY_PREFIX = "error-history";

/** The days a search with no day in its prefix reads. */
const SEARCH_DAYS = 7;

/** The entries one record shows, newest first. */
const RECORD_ENTRIES = 50;

/** A search's page when the caller names no limit. */
const DEFAULT_LIMIT = 20;

const DAY_MS = 24 * 60 * 60_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const entryViewSchema = z.object({
  at: z.string(),
  kind: z.enum(["occurrence", "status"]),
  source: z.string().nullable(),
  status: z.string().nullable(),
  message: z.string().nullable(),
  requestId: z.string().nullable(),
  sessionId: z.string().nullable(),
  taskId: z.string().nullable(),
  userId: z.string().nullable(),
  issue: z.object({ identifier: z.string().nullable(), url: z.string() }).nullable()
});

/** One report on one UTC day, as a worker reads it. */
export const errorHistoryRecordSchema = z.object({
  day: z.string(),
  ref: z.string(),
  title: z.string(),
  /** The first line of the error, or of the problem a user described. */
  error: z.string(),
  /** The status in words (`waiting in Inbox`, `filed`, …), never the stored enum. */
  status: z.string(),
  source: z.string(),
  count: z.number(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  taskIds: z.array(z.string()),
  issue: z.object({ identifier: z.string().nullable(), url: z.string() }).nullable(),
  /** That day's entries the caller may read, newest first, at most 50. */
  entries: z.array(entryViewSchema),
  /** Entries that day's hours counted past their cap and did not keep. */
  cut: z.number()
});
export type ErrorHistoryRecord = z.infer<typeof errorHistoryRecordSchema>;

const contentTemplate = parseResourceTemplate(
  [
    "<system>",
    "# {{ state.title }}",
    "",
    "Error report, {{ state.status }}. Source: {{ state.source }}. Error: {{ state.error }}",
    "Seen {{ state.count }} time(s), first {{ state.firstSeen }}, last {{ state.lastSeen }}.",
    "{% if state.issue %}Issue: {% if state.issue.identifier %}{{ state.issue.identifier }} {% endif %}{{ state.issue.url }}{% endif %}",
    "{% if state.taskIds.size > 0 %}Tasks: {{ state.taskIds | join: ', ' }}{% endif %}",
    "",
    "## {{ state.day }} (UTC), newest first",
    "",
    "{% for e in state.entries %}- {{ e.at }} {% if e.kind == 'status' %}now {{ e.status }}{% if e.issue %}: {% if e.issue.identifier %}{{ e.issue.identifier }} {% endif %}{{ e.issue.url }}{% endif %}{% else %}{{ e.source }} failed{% if e.message %}: {{ e.message }}{% endif %}{% if e.requestId %} · request {{ e.requestId }}{% endif %}{% if e.sessionId %} · session {{ e.sessionId }}{% endif %}{% if e.taskId %} · task {{ e.taskId }}{% endif %}{% if e.userId %} · user {{ e.userId }}{% endif %}{% endif %}",
    "{% endfor %}{% if state.cut > 0 %}{{ state.cut }} more occurrence(s) that day were past an hour's cap: counted, not kept.{% endif %}",
    "</system>"
  ].join("\n")
);

/** Who is reading: the operator, one user of the operator's org, or nobody the view shows anything to. */
type Viewer = { readonly kind: "operator" } | { readonly kind: "user"; readonly userId: string } | { readonly kind: "none" };

function viewerOf(ctx: ProjectedResourceContext, reporter: ErrorReporter): Viewer {
  if (ctx.orgId === undefined || ctx.orgId !== reporter.operator.orgId) return { kind: "none" };
  if (ctx.userId === reporter.operator.userId) return { kind: "operator" };
  return ctx.userId === "" ? { kind: "none" } : { kind: "user", userId: ctx.userId };
}

/** A short hash of a report's id: what keeps a `ref` unique without naming the fingerprint. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0").slice(-6);
}

/** A report's title: its draft's, else its error's first line. */
function titleOf(report: ReportResourceState): string {
  const title = report.draft?.title ?? report.parts.message.split("\n")[0] ?? "";
  return title.trim().slice(0, 120) || "an error report";
}

/** A report's path segment: a few words of its title, then its short hash. Read back by the hash alone, so a new title keeps old paths. */
function refOf(report: ReportResourceState): string {
  const words = titleOf(report)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0)
    .slice(0, 5)
    .join("-")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${words === "" ? "report" : words}-${shortHash(report.id)}`;
}

const hashOfRef = (ref: string) => ref.slice(ref.lastIndexOf("-") + 1);

const entryView = (e: HistoryEntry): z.infer<typeof entryViewSchema> => ({
  at: new Date(e.at).toISOString(),
  kind: e.kind,
  source: e.source ?? null,
  status: e.status === undefined ? null : statusInWords({ status: e.status as ReportResourceState["status"], issue: e.issue }),
  message: e.message ?? null,
  requestId: e.requestId ?? null,
  sessionId: e.sessionId ?? null,
  taskId: e.taskId ?? null,
  userId: e.userId ?? null,
  issue: e.issue === undefined ? null : { identifier: e.issue.identifier ?? null, url: e.issue.url }
});

/**
 * One day's records the viewer may read. An occurrence entry is the
 * viewer's when its user is; a status entry belongs to the report, and shows
 * to anyone the report shows to.
 */
function recordsOf(read: HistoryRead, day: string, viewer: Viewer): ErrorHistoryRecord[] {
  if (viewer.kind === "none") return [];
  const hours = read.hours.filter((hour) => hour.hour.startsWith(`${day}-`));
  const cut = hours.reduce((sum, hour) => sum + hour.cut, 0);
  const byReport = new Map<string, HistoryEntry[]>();
  for (const entry of hours.flatMap((hour) => hour.entries)) {
    const reportId = entry.reportId ?? (entry.taskId === undefined ? undefined : read.tasks[entry.taskId]);
    if (reportId === undefined) continue;
    byReport.set(reportId, [...(byReport.get(reportId) ?? []), entry]);
  }
  const records: ErrorHistoryRecord[] = [];
  for (const [reportId, entries] of byReport) {
    const report = read.reports.find((r) => r.id === reportId);
    if (report === undefined) continue;
    let visible = entries;
    if (viewer.kind === "user") {
      const own = (e: { userId?: string }) => e.userId === viewer.userId;
      const admitted = entries.some((e) => e.kind === "occurrence" && own(e)) || report.occurrences.some(own) || (report.heldRequests ?? []).some(own);
      if (!admitted) continue;
      visible = entries.filter((e) => e.kind === "status" || own(e));
    }
    if (visible.length === 0) continue;
    const ownTaskIds = visible.flatMap((e) => (e.taskId === undefined ? [] : [e.taskId]));
    const taskIds = viewer.kind === "operator" ? [...report.occurrences.flatMap((o) => (o.taskId === undefined ? [] : [o.taskId])), ...ownTaskIds] : ownTaskIds;
    records.push({
      day,
      ref: refOf(report),
      title: titleOf(report),
      error: (report.parts.message.split("\n")[0] ?? "").slice(0, 200),
      status: statusInWords(report),
      source: report.source,
      count: report.count,
      firstSeen: new Date(report.firstSeenAt).toISOString(),
      lastSeen: new Date(report.lastSeenAt).toISOString(),
      taskIds: [...new Set(taskIds)],
      issue: report.issue === undefined ? null : { identifier: report.issue.identifier ?? null, url: report.issue.url },
      entries: [...visible].sort((a, b) => b.at - a.at).slice(0, RECORD_ENTRIES).map(entryView),
      cut
    });
  }
  return records;
}

/** The days a view reads: today and the 89 before it. */
function readableDays(now: number): string[] {
  return Array.from({ length: HISTORY_RETENTION_DAYS }, (_, i) => utcDay(now - i * DAY_MS));
}

/** What a record is searched by: its title and error, status in words, source and task ids, and the words every record carries. */
function searchTextOf(record: ErrorHistoryRecord): string {
  const notFiled = record.status === "filed" || record.status === "issue closed" ? "" : "not filed";
  return ["error report", record.title, record.error, record.status, notFiled, record.source, ...record.taskIds].join(" ").toLowerCase();
}

/** Whether a record passes a `list` caller's equality filter on `status`, `source` or `taskId`. */
function passesFilter(record: ErrorHistoryRecord, filter: ResourceQuery["filter"]): boolean {
  if (filter === undefined) return true;
  for (const [field, want] of Object.entries(filter)) {
    if (field === "status" && record.status !== want) return false;
    if (field === "source" && record.source !== want) return false;
    if (field === "taskId" && !record.taskIds.includes(String(want))) return false;
  }
  return true;
}

/** Options for {@link defineErrorHistoryCollection}. */
export interface ErrorHistoryCollectionOptions {
  /** The reporter whose history it reads. Absent (a Lab with no Error Reporter): the view has no record. */
  readonly reporter?: ErrorReporter;
}

/**
 * The read-only `error-history/**` view over the Error Reporter's reports and
 * history, org scope, read by a worker's `searchResources` and
 * `readResourceContent`. A search with no day in its `prefix` reads the last
 * 7 days; `error-history/<YYYY-MM-DD>` narrows it to one. Before the reporter
 * is bound, and with no reporter, it has no record. No client reads it.
 *
 * @param options The reporter it reads through.
 */
export function defineErrorHistoryCollection(options: ErrorHistoryCollectionOptions = {}) {
  const { reporter } = options;
  return defineProjectedResourceCollection({
    pattern: `${ERROR_HISTORY_PREFIX}/**`,
    scope: "org",
    stateSchema: errorHistoryRecordSchema,
    llmReadable: true,
    contentTemplate,
    client: { state: { read: false }, content: { read: false } },
    read: async ({ key, ctx }) => {
      if (reporter === undefined) return null;
      const viewer = viewerOf(ctx, reporter);
      const slash = key.indexOf("/");
      const day = key.slice(0, slash);
      const ref = key.slice(slash + 1);
      if (viewer.kind === "none" || slash < 0 || !readableDays(Date.now()).includes(day) || ref === "" || ref.includes("/")) return null;
      const read = await reporter.readHistory([day]);
      if (read === undefined) return null;
      return recordsOf(read, day, viewer).find((record) => hashOfRef(record.ref) === hashOfRef(ref)) ?? null;
    },
    search: async ({ query, ctx }) => {
      if (reporter === undefined || viewerOf(ctx, reporter).kind === "none") return { hits: [] };
      const viewer = viewerOf(ctx, reporter);
      const prefix = (query.prefix ?? "").replace(new RegExp(`^${ERROR_HISTORY_PREFIX}(/|$)`), "").replace(/\/+$/, "");
      const day = prefix.split("/")[0]!;
      const readable = readableDays(Date.now());
      let days: string[];
      if (prefix === "") days = readable.slice(0, SEARCH_DAYS);
      else if (DAY.test(day) && readable.includes(day)) days = [day];
      else return { hits: [] };
      const read = await reporter.readHistory(days);
      if (read === undefined) return { hits: [] };
      const terms = (query.search ?? "")
        .toLowerCase()
        .split(/\W+/)
        .filter((term) => term.length > 0);
      const scored = days
        .flatMap((d) => recordsOf(read, d, viewer))
        .filter((record) => {
          const key = `${record.day}/${record.ref}`;
          return prefix === "" || key === prefix || key.startsWith(`${prefix}/`);
        })
        .filter((record) => passesFilter(record, query.filter))
        .map((record) => {
          const text = searchTextOf(record);
          return { record, score: terms.length === 0 ? 1 : terms.filter((term) => text.includes(term)).length };
        })
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score || (a.record.lastSeen < b.record.lastSeen ? 1 : a.record.lastSeen > b.record.lastSeen ? -1 : 0));
      return { hits: scored.slice(0, query.limit ?? DEFAULT_LIMIT).map(({ record }) => ({ key: `${record.day}/${record.ref}`, state: record })) };
    }
  });
}
