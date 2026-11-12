import type { LabTask } from "../adapter";

/**
 * The threads board's columns, read from the task alone (spec, "The
 * board's columns"). The lab keeps no status of its own: a column is the
 * task's status and what it waits on, plus your pins and the failures you dismissed.
 */
export type Column = "pinned" | "working" | "waiting" | "review" | "resolved";

/** The board's groups, top to bottom, with the names it shows. */
export const COLUMNS: readonly { id: Column; label: string }[] = [
  { id: "pinned", label: "Pinned" },
  { id: "working", label: "Working" },
  { id: "waiting", label: "Waiting on you" },
  { id: "review", label: "Ready for review" },
  { id: "resolved", label: "Resolved" },
];

/**
 * The key your dismissal of a failed task is kept under: its id and attempt, so a retry
 * that fails again waits on you again.
 */
export const dismissalKey = (task: Pick<LabTask, "id" | "attempts">) => `${task.id}#${task.attempts ?? 0}`;

/** The task id a `dismissalKey` names. */
export const taskOfDismissal = (key: string) => (key.lastIndexOf("#") === -1 ? key : key.slice(0, key.lastIndexOf("#")));

/** How many of a session's tasks wait on you: those under *Waiting on you* or *Ready for review*, pins aside. */
export function waitingOnYou(tasks: readonly LabTask[], dismissed: ReadonlySet<string> = new Set()): number {
  return tasks.filter((task) => {
    const column = columnOf(task, false, dismissed.has(dismissalKey(task)));
    return column === "waiting" || column === "review";
  }).length;
}

/**
 * The column a task lands in. A pinned task shows only under *Pinned*. A failure waits on
 * you until you retry or dismiss it; a dismissed one is resolved.
 */
export function columnOf(task: LabTask, pinned: boolean, dismissed = false): Column {
  if (pinned) return "pinned";
  if (task.status === "completed" || task.status === "cancelled") return "resolved";
  if (task.status === "errored") return dismissed ? "resolved" : "waiting";
  if (task.openHold?.kind === "review") return "review";
  if (task.openHold) return "waiting";
  return "working";
}
