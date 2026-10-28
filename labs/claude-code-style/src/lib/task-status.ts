import type { TaskStatus } from "../adapter";

/** How the pane names a task's status, and the token its dot and label take. */
export const TASK_STATUS: Record<TaskStatus, { label: string; tone: string; dot: string }> = {
  pending: { label: "queued", tone: "text-muted-foreground", dot: "bg-muted-foreground" },
  in_progress: { label: "running", tone: "text-info", dot: "bg-info" },
  held: { label: "held", tone: "text-muted-foreground", dot: "bg-muted-foreground" },
  completed: { label: "done", tone: "text-success", dot: "bg-success" },
  errored: { label: "failed", tone: "text-destructive", dot: "bg-destructive" },
  cancelled: { label: "cancelled", tone: "text-muted-foreground", dot: "bg-muted-foreground" },
};
