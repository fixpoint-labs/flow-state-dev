/**
 * The Error Reporter's history: one record per UTC hour, beside the reports
 * in the same collection, holding every occurrence the intake took and every
 * change of a report's status.
 *
 * Keys are `log-<YYYY-MM-DD>-<HH>`, in UTC. A record keeps at most
 * {@link HISTORY_ENTRY_CAP} entries and counts the rest in `cut`, so a burst
 * can't grow one record without bound. A day's records are read by their
 * computed keys, never by listing the collection, and records older than
 * {@link HISTORY_RETENTION_DAYS} are deleted by computed key too.
 *
 * {@link appendHistory} is the one writer. The intake and `updateReport` are
 * its only callers.
 */
import { updateStateWith } from "@flow-state-dev/core/helpers";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";

/** The key family's prefix in `error-reports/*`. */
const HISTORY_KEY_PREFIX = "log-";

/** The entries one hour's record keeps; past it they are counted in `cut`. */
const HISTORY_ENTRY_CAP = 250;

/** How many days of history are kept and read. */
export const HISTORY_RETENTION_DAYS = 90;

/** How many days past the retention a new day's first record prunes, so a Lab silent for a week still prunes. */
const PRUNE_SPAN_DAYS = 7;

/** The characters of an error or a description an entry keeps. */
export const HISTORY_MESSAGE_CHARS = 200;

const DAY_MS = 24 * 60 * 60_000;

/** One thing the history records: an occurrence the intake took, or a change of a report's status. */
const historyEntrySchema = z.object({
  at: z.number(),
  kind: z.enum(["occurrence", "status"]),
  /** What makes a second append of the same thing a no-op: the occurrence's key, or the report, status and issue. */
  key: z.string().optional(),
  /** The report it went to. A held occurrence names none: its task's report is joined when it is read. */
  reportId: z.string().optional(),
  /** That report's first sighting, which tells it from an earlier report under the same id. Absent on held and older entries. */
  since: z.number().optional(),
  /** What it came from: `request`, `held`, `task` or `manual` for an occurrence; the report's source for a status. */
  source: z.string().optional(),
  fingerprint: z.string().optional(),
  requestId: z.string().optional(),
  sessionId: z.string().optional(),
  taskId: z.string().optional(),
  boardId: z.string().optional(),
  attempt: z.number().optional(),
  userId: z.string().optional(),
  /** The start of the error or the description, redacted. */
  message: z.string().optional(),
  /** A status entry's new status. */
  status: z.string().optional(),
  /** A status entry's issue, once filed. */
  issue: z.object({ url: z.string(), identifier: z.string().optional() }).optional()
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

/** One UTC hour's record. */
export const historyHourSchema = z.object({
  /** `YYYY-MM-DD-HH`, UTC. */
  hour: z.string(),
  /** Oldest first. */
  entries: z.array(historyEntrySchema),
  /** Entries past the cap, counted and not kept. */
  cut: z.number(),
  /** The keys of the newest entries cut, so a redelivered one is counted once. Absent on older records. */
  cutKeys: z.array(z.string()).optional()
});
export type HistoryHour = z.infer<typeof historyHourSchema>;

/** The UTC day `at` falls on, `YYYY-MM-DD`. */
export function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The UTC hour `at` falls in, `YYYY-MM-DD-HH`. */
function utcHour(at: number): string {
  return new Date(at).toISOString().slice(0, 13).replace("T", "-");
}

/** The key of the hour's record `at` falls in. */
function historyKey(at: number): string {
  return `${HISTORY_KEY_PREFIX}${utcHour(at)}`;
}

/** The 24 keys of one UTC day's records. */
export function historyKeysOfDay(day: string): string[] {
  return Array.from({ length: 24 }, (_, h) => `${HISTORY_KEY_PREFIX}${day}-${String(h).padStart(2, "0")}`);
}

/** The keys of the days the first record of `day` prunes: 91 to 97 days back. */
function prunedKeys(day: string): string[] {
  const start = Date.parse(`${day}T00:00:00.000Z`);
  return Array.from({ length: PRUNE_SPAN_DAYS }, (_, i) => utcDay(start - (HISTORY_RETENTION_DAYS + 1 + i) * DAY_MS)).flatMap(historyKeysOfDay);
}

/** Whether no other hour of `at`'s day has a record yet. */
async function firstOfDay(reports: ResourceCollectionRef, at: number): Promise<boolean> {
  const own = historyKey(at);
  const others = historyKeysOfDay(utcDay(at)).filter((key) => key !== own);
  return (await Promise.all(others.map((key) => reports.getOptional(key)))).every((ref) => ref === undefined);
}

/** The dedupe key of a status entry: one per report lifetime (its first sighting), status and issue. A report reopened under the same id keeps its own. */
export function statusEntryKey(reportId: string, since: number, status: string, identifier: string | undefined): string {
  return `status:${reportId}:${since}:${status}:${identifier ?? ""}`;
}

/**
 * The first sighting of the report an entry went to: its own `since`, or for
 * an older status entry the one its {@link statusEntryKey} carries.
 * `undefined` for an older occurrence and a held one.
 *
 * @param reportId The report the entry went to.
 */
export function historyEntrySince(entry: HistoryEntry, reportId: string): number | undefined {
  if (entry.since !== undefined) return entry.since;
  const prefix = `status:${reportId}:`;
  if (entry.kind !== "status" || entry.key?.startsWith(prefix) !== true) return undefined;
  const since = Number(entry.key.slice(prefix.length).split(":")[0]);
  return Number.isFinite(since) ? since : undefined;
}

/**
 * Append one entry to its hour's record. An entry whose `key` the record
 * already holds is skipped, so a retried write appends once; past the cap the
 * entry is counted, not kept. The first record of a UTC day deletes the
 * records past the retention, by computed key.
 *
 * Never throws: the history records a report, and a history write that fails
 * must not fail the write it records. A failure is handed to `log`.
 *
 * @param reports The `error-reports/*` collection, as the running flow holds it.
 * @param entry The entry, already redacted.
 * @param log Where a failed write is said.
 */
export async function appendHistory(reports: ResourceCollectionRef, entry: HistoryEntry, log?: (message: string) => void): Promise<void> {
  try {
    const key = historyKey(entry.at);
    let ref = await reports.getOptional(key);
    if (ref === undefined) {
      if (await firstOfDay(reports, entry.at)) {
        await Promise.all(prunedKeys(utcDay(entry.at)).map((old) => reports.delete(old)));
      }
      ref = await reports.getOrCreate(key, { hour: utcHour(entry.at), entries: [], cut: 0 });
    }
    await updateStateWith(ref as never, (current: unknown) => {
      const parsed = historyHourSchema.safeParse(current);
      const record: HistoryHour = parsed.success ? parsed.data : { hour: utcHour(entry.at), entries: [], cut: 0 };
      if (entry.key !== undefined && (record.entries.some((e) => e.key === entry.key) || record.cutKeys?.includes(entry.key) === true)) {
        return { state: current as never, result: undefined };
      }
      const cutKeys = entry.key === undefined ? record.cutKeys : [...(record.cutKeys ?? []), entry.key].slice(-HISTORY_ENTRY_CAP);
      const next: HistoryHour =
        record.entries.length >= HISTORY_ENTRY_CAP
          ? { ...record, cut: record.cut + 1, ...(cutKeys === undefined ? {} : { cutKeys }) }
          : { ...record, entries: [...record.entries, entry] };
      return { state: next as never, result: undefined };
    });
  } catch (error) {
    log?.(`couldn't keep a history entry for ${entry.reportId ?? entry.taskId ?? "an occurrence"}: ${String(error)}`);
  }
}
