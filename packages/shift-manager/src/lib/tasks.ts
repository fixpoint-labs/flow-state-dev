/**
 * The numbers and words Tasks and Inbox draw in design v2's form: a row's
 * TIME, which rows the Queued toggle hides, Tasks' summary line and the empty
 * Inbox's sentence. The rows and the Inbox come from the inbox view the other
 * screens read (`inbox.ts`), and who is on shift from `workerStates` over the
 * same answer, so Tasks, Inbox and Roster agree.
 */
import { columnFor } from "./columns";
import { workerStates, shiftCounts } from "./shift";
import { openBoardTasks, type InboxViewValue } from "./inbox";
import type { BoardTaskView } from "./boards";
import type { Section } from "./failure";
import type { Worker } from "./workers";

/**
 * Where a task's composer keeps its unsent line and *unconfirmed* warning. A
 * task id is unique only on its board, so the key names both: two boards'
 * tasks that share an id keep their drafts apart.
 */
export function taskDraftKey(boardRef: string, taskId: string): string {
  return `task:${encodeURIComponent(boardRef)}/${encodeURIComponent(taskId)}`;
}

/** The key {@link taskDraftKey} replaced, which named the task id alone: read once, then dropped. */
export function legacyTaskDraftKey(taskId: string): string {
  return `task:${taskId}`;
}

/** Whether the Queued toggle hides the row: every row in the QUEUED column, blocked ones included. */
export function isQueued(row: BoardTaskView): boolean {
  return columnFor(row.status) === "QUEUED";
}

/**
 * How long a running row has been running, in v2's form (v2:912): `6m 40s`
 * under ten minutes, whole minutes after. `null` for a row that isn't running
 * or never recorded its start: only a running row's clock runs.
 */
export function elapsed(row: BoardTaskView, now: number): string | null {
  if (row.status !== "in_progress" || row.startedAt == null) return null;
  const seconds = Math.max(0, Math.floor((now - row.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes < 10 ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${minutes}m`;
}

/**
 * The row's own title, or `null` when it has none to show: a row filed with no
 * title reads its goal as its title (`toBoardTaskView`), and a Brief that prints
 * both says the same thing twice.
 */
export function distinctTitle(row: Pick<BoardTaskView, "title" | "goal"> | undefined): string | null {
  if (row === undefined || row.title === row.goal) return null;
  return row.title;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Tasks' summary line (v2:1384): the rows in flight (open and not queued), the
 * Inbox items waiting on the user, who is on shift, and how many
 * streams (the conversations holding their boards) the rows in flight run in.
 */
export function summaryLine(inbox: Section<InboxViewValue>, workers: readonly Worker[]): string {
  const inFlight = inbox.ok ? openBoardTasks(inbox.value).filter((row) => !isQueued(row)) : [];
  // An Inbox that didn't load says so: a count of 0 would read as all clear.
  const waiting = inbox.ok ? `${inbox.value.items.length} ${inbox.value.items.length === 1 ? "needs" : "need"} you` : "Inbox didn't load";
  const counts = shiftCounts(workerStates(workers, inbox.ok ? inbox.value : undefined));
  return [
    `${inFlight.length} in flight`,
    waiting,
    `${counts["on shift"]} on shift`,
    plural(new Set(inFlight.map((row) => row.ownerSessionId)).size, "stream", "streams"),
  ].join(" · ");
}

/**
 * How many sessions the running rows run in. One session can work several
 * rows, so rows linked to the same run session count once. A running row with
 * no run link (stored before the link existed, or not yet linked) counts as
 * its own session.
 */
export function runningSessions(rows: readonly BoardTaskView[]): number {
  const running = rows.filter((row) => row.status === "in_progress");
  const linked = new Set(running.flatMap((row) => (row.run == null ? [] : [row.run.sessionId])));
  return linked.size + running.filter((row) => row.run == null).length;
}

/**
 * The Shift Coordinator's summary numbers, from the inbox view's one answer:
 * what needs the user, as Inbox lists it (one item per task held on a
 * question, a review or an approval, and per ask no task holds, each once),
 * and the runs going with how many workstreams they run in.
 */
export function shiftSummary(view: InboxViewValue): { needsYou: number; running: { runs: number; workstreams: number } } {
  const inFlight = openBoardTasks(view).filter((task) => task.status === "in_progress");
  return {
    needsYou: view.items.length,
    running: { runs: inFlight.length, workstreams: new Set(inFlight.map((task) => task.ownerSessionId)).size },
  };
}

/** What Inbox says when nothing waits on the user (v2:1354): the sessions still running. */
export function nothingWaitingSentence(view: InboxViewValue): string {
  const running = runningSessions(openBoardTasks(view));
  return `Nothing needs you. ${plural(running, "session is", "sessions are")} still running.`;
}
