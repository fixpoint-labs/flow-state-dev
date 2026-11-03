import type { TaskRow } from "../adapter";

/**
 * The threads board's columns, read from the task row alone (spec, "The
 * board's columns"). The lab keeps no status of its own: a column is the
 * task's status and what it waits on, plus your pins.
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

/** How many of a session's tasks wait on you: those under *Waiting on you* or *Ready for review*, pins aside. */
export function waitingOnYou(tasks: readonly TaskRow[]): number {
  return tasks.filter((task) => {
    const column = columnOf(task, false);
    return column === "waiting" || column === "review";
  }).length;
}

/** The column a task row lands in. A pinned task shows only under *Pinned*. */
export function columnOf(task: TaskRow, pinned: boolean): Column {
  if (pinned) return "pinned";
  if (task.status === "completed" || task.status === "cancelled") return "resolved";
  if (task.status === "errored") return "waiting";
  if (task.waitingOn?.kind === "review") return "review";
  if (task.waitingOn) return "waiting";
  return "working";
}
