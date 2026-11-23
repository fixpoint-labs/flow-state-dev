import type { CodingBoardTask, TaskStatus } from "../app";
import type { TaskSignalKind, TaskSignalRun, TaskSignalView } from "../components/flow-state/task-signals";

/**
 * A coding board row as the registry's `TaskTime` reads it: the view's
 * `state` and the row's times, and this attempt's run start and lease
 * deadline. The registry item takes orchestration's `TaskView` shape, which
 * the row doesn't carry whole.
 */
export function timeSignalOf(task: Pick<CodingBoardTask, "state" | "updatedAt" | "completedAt" | "run" | "leaseUntil">): { view: TaskSignalView; run: TaskSignalRun } {
  return {
    view: { state: task.state, times: { updatedAt: task.updatedAt ?? null, completedAt: task.completedAt ?? null } },
    run: { startedAt: task.run?.startedAt ?? null, leaseUntil: task.leaseUntil ?? null },
  };
}

/** The endings a task stays in: its row moves to the tasks pane's *Done* group, and its progress note no longer says anything. Read with a row's stored status, whatever its word. */
export const FINISHED: ReadonlySet<string> = new Set(["completed", "errored", "cancelled"]);

/** How the pane names a task's status, and the token its dot and label take. */
export const TASK_STATUS: Record<TaskStatus, { label: string; tone: string; dot: string }> = {
  pending: { label: "queued", tone: "text-muted-foreground", dot: "bg-muted-foreground" },
  in_progress: { label: "running", tone: "text-info", dot: "bg-info" },
  held: { label: "held", tone: "text-muted-foreground", dot: "bg-muted-foreground" },
  completed: { label: "done", tone: "text-success", dot: "bg-success" },
  errored: { label: "failed", tone: "text-destructive", dot: "bg-destructive" },
  cancelled: { label: "cancelled", tone: "text-muted-foreground", dot: "bg-muted-foreground" },
};

/**
 * The token a task's time signal takes: a working clock keeps its row's tone, a run that stopped
 * answering (*quiet*: its lease lapsed) reads in the warning colour, and an ended task's age, or how
 * long a task no run holds has sat idle, is muted.
 */
const TASK_SIGNAL_TONE: Record<TaskSignalKind, string> = {
  working: "",
  idle: "text-muted-foreground",
  quiet: "text-warning",
  ended: "text-muted-foreground",
};

/** {@link TASK_SIGNAL_TONE} as the registry's `TaskTime` takes it. */
export const taskSignalTone = (kind: TaskSignalKind) => TASK_SIGNAL_TONE[kind];
