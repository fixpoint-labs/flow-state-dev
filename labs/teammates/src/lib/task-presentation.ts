/**
 * How a task stands, in one word and one colour. A leaf the components and
 * the status line both read, so `lib/` never imports from `components/`.
 */
import type { BoardTask } from "../adapter";
import type { TaskSignalKind } from "../components/flow-state/task-signals";

/** A task's word and the class that colours it. */
export interface TaskRowPresentation {
  word: string;
  tone: string;
}

/**
 * How a task stands, in one word and one colour, for every place the lab
 * draws a task: its row in the teammate's panel, its line in the
 * conversation (`TaskCard`), its popup and the worker's status line. One
 * reader, so they never disagree. A task that waits on you
 * says so in the attention colour (a person must act); a run that stopped
 * answering (its time signal reads *quiet*) is in the warning colour; a
 * failed one is red; the rest are quiet.
 */
export function taskRowPresentation(task: Pick<BoardTask, "status" | "waiting">, signal?: TaskSignalKind): TaskRowPresentation {
  if (task.status === "running" && task.waiting !== undefined) return { word: "waiting on you", tone: "text-attention" };
  if (signal === "quiet") return { word: "quiet", tone: "text-warning" };
  if (task.status === "failed") return { word: "failed", tone: "text-destructive" };
  return { word: task.status, tone: "text-muted-foreground" };
}
