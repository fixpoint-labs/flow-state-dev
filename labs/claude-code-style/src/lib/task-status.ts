import type { TaskStatus } from "../adapter";
import type { TaskSignalKind } from "../components/flow-state/task-signals";

/** The endings a task stays in: its row moves to the tasks pane's *Done* group, and its progress note no longer says anything. */
export const FINISHED: ReadonlySet<TaskStatus> = new Set(["completed", "errored", "cancelled"]);

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
 * answering (*quiet*: its lease lapsed) reads in the warning colour, and an ended row's age is muted.
 */
const TASK_SIGNAL_TONE: Record<TaskSignalKind, string> = {
  working: "",
  quiet: "text-warning",
  ended: "text-muted-foreground",
};

/** {@link TASK_SIGNAL_TONE} as the registry's `TaskTime` takes it. */
export const taskSignalTone = (kind: TaskSignalKind) => TASK_SIGNAL_TONE[kind];
