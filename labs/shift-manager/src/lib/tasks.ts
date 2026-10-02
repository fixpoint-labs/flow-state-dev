/**
 * The numbers and words Tasks and Inbox draw in design v2's form: a row's
 * TIME, which rows the Queued toggle hides, Tasks' summary line and the empty
 * Inbox's sentence. Every count comes from the same snapshot reads the other
 * screens use (`openRows`, `seatStates`), so Tasks, Inbox and Roster agree.
 */
import { columnFor, readStatus } from "./columns";
import { openRows, seatStates, shiftCounts, type LoadedSnapshot } from "./derive";
import type { BoardRow } from "./reads";

/** Whether the Queued toggle hides the row: every row in the QUEUED column, blocked ones included. */
export function isQueued(row: BoardRow): boolean {
  return columnFor(row.status) === "QUEUED";
}

/**
 * How long a running row has been running, in v2's form (v2:912): `6m 40s`
 * under ten minutes, whole minutes after. `null` for a row that isn't running
 * or never recorded its start: only a running row's clock runs.
 */
export function elapsed(row: BoardRow, now: number): string | null {
  if (readStatus(row.status) !== "in_progress" || row.startedAt == null) return null;
  const seconds = Math.max(0, Math.floor((now - row.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes < 10 ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${minutes}m`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Tasks' summary line (v2:1384): the rows in flight (open and not queued), the
 * asks waiting on the person, who is on shift and on call, and how many
 * workstreams the rows in flight run in.
 */
export function tasksSummary(snapshot: LoadedSnapshot): string {
  const inFlight = openRows(snapshot).filter((row) => !isQueued(row));
  const asks = snapshot.asks.ok ? snapshot.asks.value.length : 0;
  const counts = shiftCounts(seatStates(snapshot));
  return [
    `${inFlight.length} in flight`,
    `${asks} ${asks === 1 ? "needs" : "need"} you`,
    `${counts["on shift"]} on shift`,
    `${counts["on call"]} on call`,
    plural(new Set(inFlight.map((row) => row.channelId)).size, "stream", "streams"),
  ].join(" · ");
}

/** What Inbox says when nothing waits on the person (v2:1354): the runs still going, and who is on call. */
export function emptyInboxSentence(snapshot: LoadedSnapshot): string {
  const running = openRows(snapshot).filter((row) => readStatus(row.status) === "in_progress").length;
  const onCall = shiftCounts(seatStates(snapshot))["on call"];
  return `Nothing needs you. ${plural(running, "session is", "sessions are")} still running and ${plural(onCall, "worker is", "workers are")} on call.`;
}
