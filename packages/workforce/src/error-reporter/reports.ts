/**
 * The Error Reporter's report rows and its one intake (FIX-1983).
 *
 * Keys, all under one collection:
 * - `fp-<fingerprint>`: one report per fingerprint;
 * - `storm-<window start>`: the window's storm report, listing what got no report of its own;
 * - `cap`: the fingerprints that got a report in the current window;
 * - `held-<task id>`: failed requests of a task, held until the task ends;
 * - `task-<task id>`: the report a task's ending went to, where its failed requests are joined.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { updateStateWith } from "@flow-state-dev/core/helpers";
import { encodeUserSegment } from "@flow-state-dev/core/types";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { fingerprintOf, type FingerprintParts } from "./fingerprint";
import { redact } from "./redact";

/** The accessor a flow declares the report rows under. */
export const ERROR_REPORTS_RESOURCE = "errorReports";

/** The newest occurrences a row keeps. */
const KEPT_OCCURRENCES = 5;

/** The newest occurrence keys a row remembers, so a redelivered occurrence counts once. */
const KEPT_SEEN = 50;

/** The ids one occurrence is known by: what a report links and a repeat's comment names. */
const occurrenceIdsSchema = z.object({
  at: z.number(),
  requestId: z.string().optional(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  orgId: z.string().optional(),
  taskId: z.string().optional(),
  boardId: z.string().optional(),
  partition: z.string().optional(),
  attempt: z.number().optional()
});
export type OccurrenceIds = z.infer<typeof occurrenceIdsSchema>;

const requestFields = {
  requestId: z.string(),
  sessionId: z.string().optional(),
  userId: z.string(),
  orgId: z.string().optional(),
  flowKind: z.string(),
  actionName: z.string(),
  blockName: z.string().optional(),
  blockPath: z.string().optional(),
  code: z.string().optional(),
  message: z.string()
};

/**
 * One thing that went wrong, as the intake takes it. Every field is written by
 * server code (the reporter's capture, the board's drain, the conversation's
 * tool), never by a caller.
 */
export const occurrenceSchema = z.discriminatedUnion("kind", [
  /** A request that settled failed, outside any task. */
  z.object({ kind: z.literal("request"), at: z.number(), ...requestFields }),
  /** A failed request that belongs to a task: held until the task ends. */
  z.object({ kind: z.literal("held"), at: z.number(), taskId: z.string(), ...requestFields }),
  /** A task that ended errored. */
  z.object({
    kind: z.literal("task"),
    at: z.number(),
    taskId: z.string(),
    boardId: z.string(),
    partition: z.string().optional(),
    attempt: z.number(),
    error: z.string(),
    userId: z.string(),
    orgId: z.string().optional(),
    assignee: z.string().optional(),
    title: z.string().optional(),
    goal: z.string().optional(),
    requestId: z.string().optional(),
    sessionId: z.string().optional()
  }),
  /** A problem a user reported in the reporter's conversation. */
  z.object({
    kind: z.literal("manual"),
    at: z.number(),
    description: z.string(),
    userId: z.string(),
    orgId: z.string().optional(),
    /** The conversation it was reported in. */
    sessionId: z.string(),
    /** What the user named: a session, a task, a project. Read for the dossier, checked against that user. */
    named: z
      .object({ sessionId: z.string().optional(), taskId: z.string().optional(), project: z.string().optional() })
      .optional()
  })
]);
export type Occurrence = z.infer<typeof occurrenceSchema>;

/** A row's lifecycle. `owed`, `drafting` and `filing` (approved, not filed yet) are owed a run; the rest are not. */
const REPORT_STATUSES = ["owed", "drafting", "previewing", "filing", "filed", "dismissed", "closed"] as const;

/** How long a run's claim on a row holds before another run may take it over. */
export const CLAIM_LEASE_MS = 30 * 60_000;

const issueSchema = z.object({ url: z.string(), identifier: z.string().optional() });

/** One entry of a storm report's list. */
const stormEntrySchema = z.object({
  fingerprint: z.string(),
  count: z.number(),
  flowKind: z.string(),
  actionName: z.string(),
  message: z.string(),
  lastAt: z.number(),
  occurrence: occurrenceIdsSchema
});

/** A report row. */
const reportRowSchema = z.object({
  id: z.string(),
  kind: z.enum(["report", "storm"]),
  /** What made it: a failed request, a task, a user's report, or a burst. */
  source: z.enum(["request", "task", "manual", "storm"]),
  fingerprint: z.string(),
  parts: z.object({
    flowKind: z.string(),
    actionName: z.string(),
    blockPath: z.string().optional(),
    code: z.string().optional(),
    message: z.string()
  }),
  /** What a Lab's `preview.autoFile` names: the error code, or the source. */
  errorClass: z.string(),
  status: z.enum(REPORT_STATUSES),
  count: z.number(),
  firstSeenAt: z.number(),
  lastSeenAt: z.number(),
  /** Newest last. */
  occurrences: z.array(occurrenceIdsSchema),
  /** What a user wrote, for a reported problem. */
  description: z.string().optional(),
  /** What the user named with it (a session, a task, a project), and who named it. */
  named: z
    .object({ sessionId: z.string().optional(), taskId: z.string().optional(), project: z.string().optional(), by: z.string().optional() })
    .optional(),
  /** The run's draft, redacted, once it is written: what the preview shows and what files. */
  draft: z.object({ title: z.string(), body: z.string(), questions: z.array(z.string()) }).optional(),
  /** The run that holds the row while it drafts or files, until `until`. */
  claim: z.object({ by: z.string(), until: z.number() }).optional(),
  /** The operator's answer, kept from approval until the issue is filed. */
  approved: z.object({ instructions: z.string().optional() }).optional(),
  /** Keys of the occurrences already counted, newest last. */
  seen: z.array(z.string()).optional(),
  /** What the Context section names beside the ids: the failing session's project and the occurrence's links. */
  context: z.object({ project: z.string().optional(), links: z.record(z.string()).optional() }).optional(),
  /** The task fields a task's report carries. */
  task: z
    .object({ assignee: z.string().optional(), title: z.string().optional(), goal: z.string().optional(), error: z.string() })
    .optional(),
  /** Failed requests of the task, joined from its held occurrences. */
  heldRequests: z.array(occurrenceIdsSchema).optional(),
  issue: issueSchema.optional(),
  /** The issue an earlier report of this fingerprint filed, closed since. */
  previousIssue: issueSchema.optional(),
  /** A `Don't file` answer: repeats are counted with no new card until then. */
  dismissedUntil: z.number().optional(),
  filedAt: z.number().optional(),
  /** A repeat after filing owes a counted comment, at most one per comment interval. */
  commentOwed: z.boolean().optional(),
  lastCommentAt: z.number().optional(),
  countAtLastComment: z.number().optional(),
  /** Runs started for this row, and why the last one failed. */
  runs: z.number(),
  lastRunError: z.string().optional(),
  /** The report session its runs, preview and follow-ups are in. */
  sessionId: z.string().optional(),
  storm: z.object({ windowStart: z.number(), entries: z.array(stormEntrySchema) }).optional()
});
export type ReportRow = z.infer<typeof reportRowSchema>;

const capSchema = z.object({ windowStart: z.number(), fingerprints: z.array(z.string()) });
const heldSchema = z.object({ taskId: z.string(), requests: z.array(occurrenceIdsSchema.extend({ parts: z.unknown() })) });

/** The collection's declaration. Org scope: one Lab's reports, shared by its users. Never read by a browser. */
export const errorReportsCollection = defineResourceCollection({
  pattern: "error-reports/*",
  scope: "org",
  prefetchMode: "lazy",
  stateSchema: z.record(z.unknown()),
  client: { state: { read: false }, content: { read: false, create: false, update: false, delete: false } }
});

/** The flow resources that install the collection. */
export const errorReportsResources = { [ERROR_REPORTS_RESOURCE]: errorReportsCollection } as const;

/** The limits the intake applies. */
export interface ReportLimits {
  /** New reports per window, the rest into the window's storm report. Default 5. */
  readonly newPerWindow: number;
  /** The window, in ms. Default one hour. */
  readonly windowMs: number;
  /** The least time between two counted comments on one filed issue. Default one hour. */
  readonly commentEveryMs: number;
  /** How long a `Don't file` answer holds. Default 24 hours. */
  readonly dismissForMs: number;
}

export const DEFAULT_LIMITS: ReportLimits = {
  newPerWindow: 5,
  windowMs: 60 * 60_000,
  commentEveryMs: 60 * 60_000,
  dismissForMs: 24 * 60 * 60_000
};

/** What the intake did with one occurrence. */
export type IntakeDecision =
  /** A new report, owed a run. */
  | { readonly decision: "new"; readonly reportId: string }
  /** Counted on an existing report; `commentOwed` when a filed issue is owed a comment. */
  | { readonly decision: "counted"; readonly reportId: string; readonly commentOwed: boolean }
  /** Over the cap: listed on the window's storm report; `new` when that report was just made, `commentOwed` once it is filed. */
  | { readonly decision: "storm"; readonly reportId: string; readonly isNew: boolean; readonly commentOwed: boolean }
  /** A failed request of a task, held for the task's ending. */
  | { readonly decision: "held"; readonly taskId: string }
  /** The reporter's own failure: never reported. */
  | { readonly decision: "ignored"; readonly reason: string };

/** The running flow's report rows, or a refusal naming the accessor. */
export function reportsOf(ctx: BlockContext): ResourceCollectionRef {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[ERROR_REPORTS_RESOURCE];
  if (typeof ref !== "object" || ref === null || !("getOrCreate" in ref)) {
    throw new Error(`This flow doesn't declare "${ERROR_REPORTS_RESOURCE}", so it can't keep error reports.`);
  }
  return ref as ResourceCollectionRef;
}

/** The key of a fingerprint's report. */
const reportKey = (fingerprint: string) => `fp-${fingerprint}`;
const stormKey = (windowStart: number) => `storm-${windowStart}`;
const heldKey = (taskId: string) => `held-${encodeUserSegment(taskId)}`;
const taskKey = (taskId: string) => `task-${encodeUserSegment(taskId)}`;
const CAP_KEY = "cap";

/** A stored row, parsed; `undefined` for an empty or malformed one. */
function parseRow(state: unknown): ReportRow | undefined {
  const parsed = reportRowSchema.safeParse(state);
  return parsed.success ? parsed.data : undefined;
}

/** Read one report row by its key. */
export async function readReport(reports: ResourceCollectionRef, reportId: string): Promise<ReportRow | undefined> {
  const ref = await reports.getOptional(reportId);
  return ref === undefined ? undefined : parseRow(ref.state);
}

/** Every report row (storms included), newest seen first. */
export async function listReports(reports: ResourceCollectionRef): Promise<ReportRow[]> {
  const refs = await reports.list();
  return refs
    .map((ref) => parseRow(ref.state))
    .filter((row): row is ReportRow => row !== undefined)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

/**
 * Change one row through a compare-and-set, re-running `change` against the
 * fresher row on a conflict. `change` returns the row to write, or `undefined`
 * to write nothing.
 */
export async function updateReport(
  reports: ResourceCollectionRef,
  reportId: string,
  change: (row: ReportRow) => ReportRow | undefined
): Promise<ReportRow | undefined> {
  const ref = await reports.getOptional(reportId);
  if (ref === undefined) return undefined;
  return updateStateWith(ref as never, (current: unknown) => {
    const row = parseRow(current);
    const next = row === undefined ? undefined : change(row);
    return { state: (next ?? current) as never, result: next ?? row };
  });
}

/** Whether a row still takes repeats, or a repeat now starts a new report. */
function isLive(row: ReportRow, now: number): boolean {
  if (row.status === "closed") return false;
  if (row.status === "dismissed") return row.dismissedUntil !== undefined && now < row.dismissedUntil;
  return true;
}

function idsOf(occurrence: Occurrence): OccurrenceIds {
  const ids: OccurrenceIds = { at: occurrence.at };
  const from = occurrence as Record<string, unknown>;
  for (const key of ["requestId", "sessionId", "userId", "orgId", "taskId", "boardId", "partition", "attempt"] as const) {
    if (from[key] !== undefined) (ids as Record<string, unknown>)[key] = from[key];
  }
  return ids;
}

const keepNewest = <T>(list: readonly T[], item: T): T[] => [...list, item].slice(-KEPT_OCCURRENCES);

/** The parts a request occurrence is fingerprinted by. */
function requestParts(o: { flowKind: string; actionName: string; blockPath?: string; code?: string; message: string }): FingerprintParts {
  return { flowKind: o.flowKind, actionName: o.actionName, blockPath: o.blockPath, code: o.code, message: o.message };
}

/**
 * The key one occurrence is counted under, so a redelivery of it counts once:
 * a request by its id, a task's ending by its board, task and attempt. A
 * user's report has none: each message is a report of its own.
 */
function occurrenceKey(occurrence: Occurrence): string | undefined {
  switch (occurrence.kind) {
    case "request":
    case "held":
      return `request:${occurrence.requestId}`;
    case "task":
      return `task:${occurrence.boardId}:${occurrence.partition ?? ""}:${occurrence.taskId}:${occurrence.attempt}`;
    case "manual":
      return undefined;
  }
}

const withSeen = (seen: readonly string[] | undefined, key: string | undefined): string[] | undefined =>
  key === undefined ? seen?.slice() : [...(seen ?? []), key].slice(-KEPT_SEEN);

/**
 * Take one occurrence: hold it, count it, or make a report for it, under the
 * cap. The occurrence is redacted before anything of it is written.
 *
 * @param reports The report rows, as the running flow holds them.
 * @param occurrence What went wrong.
 * @param options The reporter's own flow (never reported), the limits, and the values no row may hold.
 */
export async function intakeOccurrence(
  reports: ResourceCollectionRef,
  raw: Occurrence,
  options: { readonly reporterFlow: string; readonly limits?: Partial<ReportLimits>; readonly secrets?: readonly string[] }
): Promise<IntakeDecision> {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const occurrence = redact(raw, options.secrets ?? []);
  const now = occurrence.at;
  if ((occurrence.kind === "request" || occurrence.kind === "held") && occurrence.flowKind === options.reporterFlow) {
    return { decision: "ignored", reason: "the Error Reporter never reports its own failures" };
  }

  if (occurrence.kind === "held") {
    const ref = await reports.getOrCreate(heldKey(occurrence.taskId), { taskId: occurrence.taskId, requests: [] });
    await updateStateWith(ref as never, (current: unknown) => {
      const held = heldSchema.safeParse(current);
      const requests = held.success ? held.data.requests : [];
      if (requests.some((r) => r.requestId === occurrence.requestId)) return { state: current as never, result: undefined };
      return {
        state: { taskId: occurrence.taskId, requests: keepNewest(requests, { ...idsOf(occurrence), parts: requestParts(occurrence) }) } as never,
        result: undefined
      };
    });
    // Written before the task's mapping is read, as the task's intake writes its mapping before reading
    // these: whichever runs second sees the other, so the request joins the task's report either way.
    const taskRef = await reports.getOptional(taskKey(occurrence.taskId));
    const reportId = (taskRef?.state as { reportId?: unknown } | undefined)?.reportId;
    if (typeof reportId === "string") await joinHeld(reports, reportId, await heldOf(reports, occurrence.taskId));
    return { decision: "held", taskId: occurrence.taskId };
  }

  // What this occurrence is fingerprinted by, and what its new report would carry.
  let parts: FingerprintParts;
  let source: ReportRow["source"];
  let task: ReportRow["task"];
  let description: string | undefined;
  let named: ReportRow["named"];
  switch (occurrence.kind) {
    case "request":
      parts = requestParts(occurrence);
      source = "request";
      break;
    case "task":
      // By the task's ending, never by which of its failed requests arrived first.
      parts = { flowKind: "task", actionName: occurrence.assignee ?? "unassigned", code: "task-errored", message: occurrence.error };
      task = { assignee: occurrence.assignee, title: occurrence.title, goal: occurrence.goal, error: occurrence.error };
      source = "task";
      break;
    case "manual":
      parts = { flowKind: "manual", actionName: "reported", code: "reported", message: occurrence.description };
      source = "manual";
      description = occurrence.description;
      named = occurrence.named === undefined ? undefined : { ...occurrence.named, by: occurrence.userId };
      break;
  }
  const fingerprint = await fingerprintOf(parts);
  const key = reportKey(fingerprint);
  const ids = idsOf(occurrence);
  const seenKey = occurrenceKey(occurrence);
  const decided = await decide();
  // A task's report is where its failed requests are joined: the mapping first, then a fresh read of them.
  if (occurrence.kind === "task" && (decided.decision === "new" || decided.decision === "counted" || decided.decision === "storm")) {
    await reports.upsert(taskKey(occurrence.taskId), { reportId: decided.reportId } as never);
    if (decided.decision !== "storm") await joinHeld(reports, decided.reportId, await heldOf(reports, occurrence.taskId));
  }
  return decided;

  async function decide(): Promise<IntakeDecision> {
    // A repeat of a live report only raises its count.
    const counted = await countOn(reports, key, ids, seenKey, now, limits);
    if (counted !== undefined) return counted;

    const slot = await claimCapSlot(reports, fingerprint, now, limits);
    if (slot.claimed) {
      const ref = await reports.getOrCreate(key, {});
      const made = await updateStateWith(ref as never, (current: unknown) => {
        const existing = parseRow(current);
        // Another intake made it first: this is a repeat after all.
        if (existing !== undefined && isLive(existing, now)) return { state: current as never, result: false };
        const row: ReportRow = {
          id: key,
          kind: "report",
          source,
          fingerprint,
          parts,
          errorClass: parts.code ?? source,
          status: "owed",
          count: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          occurrences: [ids],
          runs: 0,
          ...(seenKey === undefined ? {} : { seen: [seenKey] }),
          ...(description === undefined ? {} : { description }),
          ...(named === undefined ? {} : { named }),
          ...(task === undefined ? {} : { task }),
          // A failure back after its issue was closed links the old issue.
          ...(existing?.status === "closed" && existing.issue !== undefined ? { previousIssue: existing.issue } : {})
        };
        return { state: row as never, result: true };
      });
      if (made === true) return { decision: "new", reportId: key };
      return (await countOn(reports, key, ids, seenKey, now, limits)) ?? { decision: "counted", reportId: key, commentOwed: false };
    }
    return listOnStorm(reports, slot.windowStart, { fingerprint, parts, ids, seenKey, now, limits });
  }
}

/**
 * Claim a place under the cap for a new fingerprint. Idempotent per
 * fingerprint, so two intakes of one fingerprint spend one place. The window
 * never moves back: a late occurrence (an old task's ending) counts in the
 * current window.
 *
 * @returns Whether it has a place, and the window it was counted in.
 */
async function claimCapSlot(
  reports: ResourceCollectionRef,
  fingerprint: string,
  now: number,
  limits: ReportLimits
): Promise<{ claimed: boolean; windowStart: number }> {
  const own = Math.floor(now / limits.windowMs) * limits.windowMs;
  const capRef = await reports.getOrCreate(CAP_KEY, { windowStart: own, fingerprints: [] });
  type Slot = { claimed: boolean; windowStart: number };
  return updateStateWith(capRef as never, (current: unknown): { state: never; result: Slot } => {
    const parsed = capSchema.safeParse(current);
    const stored = parsed.success ? parsed.data : undefined;
    const cap = stored !== undefined && stored.windowStart >= own ? stored : { windowStart: own, fingerprints: [] };
    const windowStart = cap.windowStart;
    if (cap.fingerprints.includes(fingerprint)) return { state: cap as never, result: { claimed: true, windowStart } };
    if (cap.fingerprints.length >= limits.newPerWindow) return { state: cap as never, result: { claimed: false, windowStart } };
    return { state: { windowStart, fingerprints: [...cap.fingerprints, fingerprint] } as never, result: { claimed: true, windowStart } };
  }) as Promise<Slot>;
}

/**
 * List an over-cap occurrence on its window's storm report. A storm report
 * already filed owes a counted comment, as a repeat of a filed report does.
 */
async function listOnStorm(
  reports: ResourceCollectionRef,
  windowStart: number,
  o: {
    readonly fingerprint: string;
    readonly parts: FingerprintParts;
    readonly ids: OccurrenceIds;
    readonly seenKey: string | undefined;
    readonly now: number;
    readonly limits: ReportLimits;
  }
): Promise<IntakeDecision> {
  const sKey = stormKey(windowStart);
  const stormRef = await reports.getOrCreate(sKey, {});
  const result = await updateStateWith(stormRef as never, (current: unknown) => {
    const existing = parseRow(current);
    if (existing !== undefined && o.seenKey !== undefined && existing.seen?.includes(o.seenKey)) {
      return { state: current as never, result: { isNew: false, commentOwed: false } };
    }
    const entries = existing?.storm?.entries ?? [];
    const at = entries.findIndex((entry) => entry.fingerprint === o.fingerprint);
    const entry =
      at >= 0
        ? { ...entries[at]!, count: entries[at]!.count + 1, lastAt: o.now, occurrence: o.ids }
        : { fingerprint: o.fingerprint, count: 1, flowKind: o.parts.flowKind, actionName: o.parts.actionName, message: o.parts.message, lastAt: o.now, occurrence: o.ids };
    const nextEntries = at >= 0 ? entries.map((e, i) => (i === at ? entry : e)) : [...entries, entry];
    const row: ReportRow = existing ?? {
      id: sKey,
      kind: "storm",
      source: "storm",
      fingerprint: `storm-${windowStart}`,
      parts: { flowKind: "storm", actionName: "storm", message: "More failures than the reporter files one by one in this window" },
      errorClass: "storm",
      status: "owed",
      count: 0,
      firstSeenAt: o.now,
      lastSeenAt: o.now,
      occurrences: [],
      runs: 0
    };
    const commentOwed = commentOwedOn(row, o.now, o.limits);
    const next: ReportRow = {
      ...row,
      count: row.count + 1,
      lastSeenAt: o.now,
      occurrences: keepNewest(row.occurrences, o.ids),
      storm: { windowStart, entries: nextEntries },
      ...(o.seenKey === undefined ? {} : { seen: withSeen(row.seen, o.seenKey) }),
      ...(commentOwed ? { commentOwed: true } : {})
    };
    return { state: next as never, result: { isNew: existing === undefined, commentOwed } };
  });
  const { isNew, commentOwed } = result as { isNew: boolean; commentOwed: boolean };
  return { decision: "storm", reportId: sKey, isNew, commentOwed };
}

/** Whether a repeat now owes a filed report's issue a counted comment. */
function commentOwedOn(row: ReportRow, now: number, limits: ReportLimits): boolean {
  const since = row.lastCommentAt ?? row.filedAt ?? 0;
  return row.status === "filed" && (row.commentOwed === true || now - since >= limits.commentEveryMs);
}

/** The failed requests held for a task, without their fingerprint parts. */
async function heldOf(reports: ResourceCollectionRef, taskId: string): Promise<OccurrenceIds[]> {
  const ref = await reports.getOptional(heldKey(taskId));
  const held = ref === undefined ? undefined : heldSchema.safeParse(ref.state);
  return (held?.success === true ? held.data.requests : []).map(({ parts: _parts, ...ids }) => ids);
}

/** Add `requests` to a report's joined requests, each once. */
async function joinHeld(reports: ResourceCollectionRef, reportId: string, requests: readonly OccurrenceIds[]): Promise<void> {
  if (requests.length === 0) return;
  await updateReport(reports, reportId, (row) => {
    const known = row.heldRequests ?? [];
    const fresh = requests.filter((r) => !known.some((k) => k.requestId === r.requestId));
    return fresh.length === 0 ? undefined : { ...row, heldRequests: [...known, ...fresh].slice(-KEPT_OCCURRENCES) };
  });
}

/**
 * Count `ids` on the live report at `key`, or `undefined` when there is none.
 * An occurrence already counted there (a redelivery) is not counted again.
 */
async function countOn(
  reports: ResourceCollectionRef,
  key: string,
  ids: OccurrenceIds,
  seenKey: string | undefined,
  now: number,
  limits: ReportLimits
): Promise<IntakeDecision | undefined> {
  const ref = await reports.getOptional(key);
  if (ref === undefined) return undefined;
  const result = await updateStateWith(ref as never, (current: unknown) => {
    const row = parseRow(current);
    if (row === undefined || !isLive(row, now)) return { state: current as never, result: undefined };
    if (seenKey !== undefined && row.seen?.includes(seenKey)) return { state: current as never, result: { commentOwed: false } };
    const commentOwed = commentOwedOn(row, now, limits);
    const next: ReportRow = {
      ...row,
      count: row.count + 1,
      lastSeenAt: now,
      occurrences: keepNewest(row.occurrences, ids),
      ...(seenKey === undefined ? {} : { seen: withSeen(row.seen, seenKey) }),
      ...(commentOwed ? { commentOwed: true } : {})
    };
    return { state: next as never, result: { commentOwed } };
  });
  if (result === undefined) return undefined;
  return { decision: "counted", reportId: key, commentOwed: (result as { commentOwed: boolean }).commentOwed };
}
