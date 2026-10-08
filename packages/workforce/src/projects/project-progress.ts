/**
 * A project's progress, worked out from its workstream entries each time it
 * is read: how many workstreams stand where, how many objectives are met, the
 * next due date, and which entries have gone quiet. Nothing is stored: a
 * total kept on the row would drift from the entries, and every owner's
 * update would contend on it.
 *
 * A pure function over entries a caller already read with one prefix read
 * (`readProject` on the server, the resource route in a browser), so the
 * server and Shift Manager answer the same way. A leaf with no imports, so the
 * browser entry exports it.
 */

/** How long an entry can go unchanged before it reads as stale: seven days. */
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** The statuses a workstream can be in, in the order progress counts them. */
export const WORKSTREAM_STATUSES = ["on-track", "at-risk", "blocked", "done"] as const;

/** One entry as progress reads it: its place, and the fields it counts. */
export type ProgressEntry = {
  owner: string;
  id: string;
  status: string;
  due: string | null;
  objectives: readonly { met: boolean }[];
  updatedAt: string;
};

/** A project's progress. */
export type ProjectProgress = {
  /** How many workstreams the project has, done ones included. */
  workstreams: number;
  /** How many stand at each status. */
  byStatus: Record<(typeof WORKSTREAM_STATUSES)[number], number>;
  /** Objectives met, of all the objectives of every workstream. */
  objectives: { met: number; total: number };
  /** The earliest due date of a workstream that isn't done, overdue ones included, or `null`. */
  nextDue: string | null;
  /** The workstreams not done whose entry hasn't changed for {@link STALE_AFTER_MS}, oldest first. */
  stale: { owner: string; id: string; updatedAt: string }[];
};

/**
 * Work out a project's progress from its entries.
 *
 * @param entries The project's entries, as one prefix read returned them.
 * @param now The time to judge staleness against, in milliseconds. A caller
 *   passes the clock's; a test passes its own.
 */
export function projectProgress(entries: readonly ProgressEntry[], now: number): ProjectProgress {
  const byStatus = { "on-track": 0, "at-risk": 0, blocked: 0, done: 0 };
  let met = 0;
  let total = 0;
  let nextDue: string | null = null;
  const stale: ProjectProgress["stale"] = [];
  for (const entry of entries) {
    if (Object.hasOwn(byStatus, entry.status)) byStatus[entry.status as keyof typeof byStatus] += 1;
    total += entry.objectives.length;
    met += entry.objectives.filter((objective) => objective.met).length;
    if (entry.status === "done") continue;
    if (entry.due !== null && (nextDue === null || entry.due < nextDue)) nextDue = entry.due;
    const updated = Date.parse(entry.updatedAt);
    if (Number.isFinite(updated) && now - updated >= STALE_AFTER_MS) {
      stale.push({ owner: entry.owner, id: entry.id, updatedAt: entry.updatedAt });
    }
  }
  stale.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0));
  return { workstreams: entries.length, byStatus, objectives: { met, total }, nextDue, stale };
}
