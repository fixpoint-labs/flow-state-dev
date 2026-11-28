/**
 * The error history as a worker reads it: a read-only projected collection,
 * `error-history/<YYYY-MM-DD>/<ref>`, one record per report per UTC day it
 * has an entry. Workers reach it with core's `searchResources` and
 * `readResourceContent`; there is no tool made for it.
 *
 * Nothing is stored here. Each `read` and `search` works out who is reading
 * from the caller the framework hands the hook (`ctx.userId`, `ctx.orgId`,
 * both server-derived) and runs the reporter's history read through its bound
 * host, as the operator, naming that reader and what it asks for. The read
 * projects and filters inside that run, so what it returns (and records) is
 * only the records the reader may read: the operator reads every report;
 * another user of the operator's org reads a report only of their own
 * failures; anyone else reads nothing, and `read` answers as it does for an
 * unknown key. Search words narrow only what the caller may read.
 */
import { defineProjectedResourceCollection } from "@flow-state-dev/core";
import { parseResourceTemplate } from "@flow-state-dev/core/resource-template";
import type { ProjectedResourceContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { HISTORY_RETENTION_DAYS, historyEntrySince, utcDay, type HistoryEntry } from "./history";
import type { ErrorReporter } from "./reporter";
import { statusInWords, type EarlierReport, type HistoryRead, type ReportResourceState } from "./reports";

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
const errorHistoryRecordSchema = z.object({
  day: z.string(),
  ref: z.string(),
  /** The report's drafted title for the operator; for a user, their own newest error's first line. */
  title: z.string(),
  /** The first line of the error, or of the problem a user described: for a user, their own. */
  error: z.string(),
  /** The status in words (`waiting in Inbox`, `filed`, …), never the stored enum. */
  status: z.string(),
  source: z.string(),
  /** The report's count for the operator; for a user, their own occurrences that day. */
  count: z.number(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  taskIds: z.array(z.string()),
  /** The filed issue: the operator's alone, `null` for a user. */
  issue: z.object({ identifier: z.string().nullable(), url: z.string() }).nullable(),
  /** The report's Inbox item while it waits there, as a Markdown link: the operator's alone, `null` for a user and once it stops waiting. */
  inbox: z.string().nullable(),
  /** That day's entries the caller may read, newest first, at most 50. */
  entries: z.array(entryViewSchema),
  /** Entries that day's hours counted past their cap and did not keep: the operator's alone, 0 for a user. */
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
    "{% if state.inbox %}{{ state.inbox }}{% endif %}",
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

/**
 * What the history read is asked: who reads, which days, and either one
 * record (`ref`) or a search. Only the reporter's internal run takes it; the
 * view fills `viewer` from the trusted caller.
 */
export const historyRequestSchema = z.object({
  viewer: z.discriminatedUnion("kind", [z.object({ kind: z.literal("operator") }), z.object({ kind: z.literal("user"), userId: z.string().min(1) })]),
  days: z.array(z.string().regex(DAY)).max(HISTORY_RETENTION_DAYS),
  ref: z.string().optional(),
  prefix: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().int().positive().max(100).optional()
});
export type HistoryRequest = z.infer<typeof historyRequestSchema>;

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

/** A title from a draft's title or an error's first line; `an error report` when there is neither. */
function titleFrom(text: string | undefined): string {
  return (text?.split("\n")[0] ?? "").trim().slice(0, 120) || "an error report";
}

/** A record's path segment: a few words of its title, then its report's short hash. Read back by the hash alone, so a new title keeps old paths. */
function refOf(title: string, reportId: string): string {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0)
    .slice(0, 5)
    .join("-")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${words === "" ? "report" : words}-${shortHash(reportId)}`;
}

const hashOfRef = (ref: string) => ref.slice(ref.lastIndexOf("-") + 1);

const entryView = (e: HistoryEntry, withIssue: boolean): z.infer<typeof entryViewSchema> => ({
  at: new Date(e.at).toISOString(),
  kind: e.kind,
  source: e.source ?? null,
  status: e.status === undefined ? null : statusInWords({ status: e.status as ReportResourceState["status"], issue: e.issue }),
  message: e.message ?? null,
  requestId: e.requestId ?? null,
  sessionId: e.sessionId ?? null,
  taskId: e.taskId ?? null,
  userId: e.userId ?? null,
  issue: e.issue === undefined || !withIssue ? null : { identifier: e.issue.identifier ?? null, url: e.issue.url }
});

/** A report's Inbox item as a Markdown link, or `undefined` when the Lab names no link. */
type InboxLinkOf = (reportId: string) => string | undefined;

/**
 * Which report under one id an entry belongs to: the current one, or an
 * earlier one a repeat after it replaced. `summary` is what that earlier
 * report was, when the current report kept it.
 */
type Lifetime = { readonly current: true } | { readonly current: false; readonly key: string; readonly summary?: EarlierReport };

/**
 * The report an entry belongs to. By the first sighting it names; an entry
 * that names none is the current report's from its first sighting on, and
 * before it the earlier report that had started by then, of those the report
 * kept or the day's entries name (`known`, sorted, oldest first). With none
 * started by then, it is a late occurrence of the current report.
 */
function lifetimeOf(entry: HistoryEntry, since: number | undefined, report: ReportResourceState, known: readonly number[]): Lifetime {
  if (since === undefined ? entry.at >= report.firstSeenAt : since === report.firstSeenAt) return { current: true };
  const earlier = report.earlier ?? [];
  const started = since ?? known.filter((s) => s <= entry.at).at(-1);
  // Nothing says an earlier report had started: a late occurrence of the current one (a storm's, an older entry's).
  if (started === undefined) return { current: true };
  const summary = earlier.find((e) => e.since === started);
  const key = String(started);
  return summary === undefined ? { current: false, key } : { current: false, key, summary };
}

/**
 * One day's records the viewer may read. An occurrence entry is the
 * viewer's when its user is; a status entry belongs to the report, and shows
 * to anyone the report shows to. One fingerprint can hold several users'
 * failures, so a user's record is built from their own occurrences alone: its
 * title, error, count and times are theirs, and it carries none of what comes
 * from every user's failures (the drafted title, the report's count, its
 * issue, the hours' cut).
 *
 * A failure back after its report's issue closed starts a new report under
 * the same id. A day's entries of an earlier report make their own record,
 * with that report's title, status, count and issue as it kept them; an
 * earlier report the current one did not keep shows what its entries say.
 */
function recordsOf(read: HistoryRead, day: string, viewer: Viewer, inboxOf: InboxLinkOf): ErrorHistoryRecord[] {
  if (viewer.kind === "none") return [];
  const hours = read.hours.filter((hour) => hour.hour.startsWith(`${day}-`));
  const cut = hours.reduce((sum, hour) => sum + hour.cut, 0);
  const dayEntries = hours.flatMap((hour) => hour.entries);
  const reports = new Map(read.reports.map((r) => [r.id, r]));
  // The first sightings each report's earlier reports started at, kept or named that day: sorted once per day.
  const named = new Map<string, Set<number>>();
  for (const e of dayEntries) {
    const since = e.reportId === undefined ? undefined : historyEntrySince(e, e.reportId);
    if (since === undefined) continue;
    const seen = named.get(e.reportId!);
    if (seen === undefined) named.set(e.reportId!, new Set([since]));
    else seen.add(since);
  }
  const knownCache = new Map<string, number[]>();
  const knownOf = (report: ReportResourceState): number[] => {
    let known = knownCache.get(report.id);
    if (known === undefined) {
      known = [...new Set([...(report.earlier ?? []).map((e) => e.since), ...(named.get(report.id) ?? [])])].sort((x, y) => x - y);
      knownCache.set(report.id, known);
    }
    return known;
  };
  const groups = new Map<string, { report: ReportResourceState; lifetime: Lifetime; entries: HistoryEntry[] }>();
  for (const entry of dayEntries) {
    const reportId = entry.reportId ?? (entry.taskId === undefined ? undefined : read.tasks[entry.taskId]);
    const report = reportId === undefined ? undefined : reports.get(reportId);
    if (report === undefined) continue;
    // A held request goes with the report its task's mapping names; an older mapping names none, and it goes with the current report.
    const since = entry.reportId === undefined ? (read.taskSince[entry.taskId!] ?? report.firstSeenAt) : historyEntrySince(entry, report.id);
    const lifetime = lifetimeOf(entry, since, report, knownOf(report));
    const groupKey = lifetime.current ? report.id : `${report.id}@${lifetime.key}`;
    const grouped = groups.get(groupKey);
    if (grouped === undefined) groups.set(groupKey, { report, lifetime, entries: [entry] });
    else grouped.entries.push(entry);
  }
  const records: ErrorHistoryRecord[] = [];
  for (const { report, lifetime, entries } of groups.values()) {
    let visible = entries;
    if (viewer.kind === "user") {
      const own = (e: { userId?: string }) => e.userId === viewer.userId;
      // The report's own list of users outlives the entries an hour's cap cut and the occurrences it no longer keeps.
      // An earlier report kept no such list: only the user's own entries that day admit them.
      const admitted =
        entries.some((e) => e.kind === "occurrence" && own(e)) ||
        (lifetime.current && ((report.userIds ?? []).includes(viewer.userId) || report.occurrences.some(own) || (report.heldRequests ?? []).some(own)));
      if (!admitted) continue;
      visible = entries.filter((e) => e.kind === "status" || own(e));
    }
    if (visible.length === 0) continue;
    const ownTaskIds = visible.flatMap((e) => (e.taskId === undefined ? [] : [e.taskId]));
    const newestFirst = [...visible].sort((a, b) => b.at - a.at);
    const entriesShown = newestFirst.slice(0, RECORD_ENTRIES).map((e) => entryView(e, viewer.kind === "operator"));
    const occurrences = newestFirst.filter((e) => e.kind === "occurrence");
    // A record's path is read back by its hash: an earlier report's is its own, so it never answers for the current one.
    const refId = lifetime.current ? report.id : `${report.id}@${lifetime.key}`;
    const summary = lifetime.current ? undefined : lifetime.summary;
    // What an earlier report the current one did not keep last said of itself that day.
    const lastStatus = newestFirst.find((e) => e.kind === "status");
    const status = lifetime.current
      ? statusInWords(report)
      : summary !== undefined
        ? statusInWords(summary)
        : lastStatus !== undefined
          ? statusInWords({ status: lastStatus.status as ReportResourceState["status"], issue: lastStatus.issue })
          : "reported again since";
    if (viewer.kind === "operator") {
      const title = lifetime.current
        ? titleFrom(report.draft?.title ?? report.parts.message)
        : titleFrom(summary?.title ?? occurrences[0]?.message ?? report.parts.message);
      const error = lifetime.current ? report.parts.message : (summary?.error ?? occurrences[0]?.message ?? report.parts.message);
      const issue = lifetime.current ? report.issue : summary !== undefined ? summary.issue : newestFirst.find((e) => e.issue !== undefined)?.issue;
      records.push({
        day,
        ref: refOf(title, refId),
        title,
        error: (error.split("\n")[0] ?? "").slice(0, 200),
        status,
        source: report.source,
        count: lifetime.current ? report.count : (summary?.count ?? occurrences.length),
        firstSeen: new Date(lifetime.current ? report.firstSeenAt : (summary?.since ?? newestFirst.at(-1)!.at)).toISOString(),
        lastSeen: new Date(lifetime.current ? report.lastSeenAt : (summary?.lastSeenAt ?? newestFirst[0]!.at)).toISOString(),
        taskIds: [...new Set([...(lifetime.current ? report.occurrences.flatMap((o) => (o.taskId === undefined ? [] : [o.taskId])) : []), ...ownTaskIds])],
        issue: issue === undefined ? null : { identifier: issue.identifier ?? null, url: issue.url },
        inbox: lifetime.current && report.status === "previewing" ? (inboxOf(report.id) ?? null) : null,
        entries: entriesShown,
        cut
      });
      continue;
    }
    // The user's own occurrences that day, newest first: what their record is made of.
    const timed = occurrences.length > 0 ? occurrences : newestFirst;
    const title = titleFrom(occurrences[0]?.message);
    records.push({
      day,
      ref: refOf(title, refId),
      title,
      error: (occurrences[0]?.message?.split("\n")[0] ?? "").slice(0, 200),
      status,
      source: report.source,
      count: occurrences.length,
      firstSeen: new Date(timed.at(-1)!.at).toISOString(),
      lastSeen: new Date(timed[0]!.at).toISOString(),
      taskIds: [...new Set(ownTaskIds)],
      issue: null,
      inbox: null,
      entries: entriesShown,
      cut: 0
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

/**
 * The records a history request asks for, out of the days it read: the one
 * record `ref` names, or a search's best hits, at most `limit`. Only what the
 * viewer may read. What the reporter's history run returns.
 *
 * @param read The requested days' hours, with the reports they name.
 * @param request Who reads, and what.
 * @param inboxOf The link to a waiting report's Inbox item, put on the operator's records alone.
 */
export function historyRecords(read: HistoryRead, request: HistoryRequest, inboxOf: InboxLinkOf): ErrorHistoryRecord[] {
  const { viewer, days } = request;
  if (request.ref !== undefined) {
    const hash = hashOfRef(request.ref);
    return days.flatMap((d) => recordsOf(read, d, viewer, inboxOf)).filter((record) => hashOfRef(record.ref) === hash).slice(0, 1);
  }
  const prefix = request.prefix ?? "";
  const terms = (request.search ?? "")
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length > 0);
  return days
    .flatMap((d) => recordsOf(read, d, viewer, inboxOf))
    .filter((record) => {
      const key = `${record.day}/${record.ref}`;
      return prefix === "" || key === prefix || key.startsWith(`${prefix}/`);
    })
    .map((record) => {
      const text = searchTextOf(record);
      return { record, score: terms.length === 0 ? 1 : terms.filter((term) => text.includes(term)).length };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || (a.record.lastSeen < b.record.lastSeen ? 1 : a.record.lastSeen > b.record.lastSeen ? -1 : 0))
    .slice(0, request.limit ?? DEFAULT_LIMIT)
    .map(({ record }) => record);
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
      const records = await reporter.readHistory({ viewer, days: [day], ref });
      return records?.[0] ?? null;
    },
    search: async ({ query, ctx }) => {
      if (reporter === undefined) return { hits: [] };
      const viewer = viewerOf(ctx, reporter);
      if (viewer.kind === "none") return { hits: [] };
      const prefix = (query.prefix ?? "").replace(new RegExp(`^${ERROR_HISTORY_PREFIX}(/|$)`), "").replace(/\/+$/, "");
      const day = prefix.split("/")[0]!;
      const readable = readableDays(Date.now());
      let days: string[];
      if (prefix === "") days = readable.slice(0, SEARCH_DAYS);
      else if (DAY.test(day) && readable.includes(day)) days = [day];
      else return { hits: [] };
      const records = await reporter.readHistory({
        viewer,
        days,
        prefix,
        ...(query.search === undefined ? {} : { search: query.search }),
        limit: Math.min(query.limit ?? DEFAULT_LIMIT, 100)
      });
      return { hits: (records ?? []).map((record) => ({ key: `${record.day}/${record.ref}`, state: record })) };
    }
  });
}
