/**
 * How a task stands, in one word and one colour. A leaf the components and
 * the status line both read, so `lib/status` needn't import a component module.
 */
import type { BoardTask } from "../app";
import type { TaskSignalKind } from "../components/flow-state/task-signals";

/** The colour a status badge takes. A closed set, so a badge never guesses a colour from its words. */
export type BadgeTone = "attention" | "warning" | "destructive" | "success" | "info" | "muted";

/** A task's word, the class that colours it, and its badge's colour. */
export interface TaskPresentation {
  word: string;
  tone: string;
  badge: BadgeTone;
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
export function taskPresentation(task: Pick<BoardTask, "status" | "waiting">, signal?: TaskSignalKind): TaskPresentation {
  if (task.status === "running" && task.waiting !== undefined) return { word: "waiting on you", tone: "text-attention", badge: "attention" };
  if (signal === "quiet") return { word: "quiet", tone: "text-warning", badge: "warning" };
  if (task.status === "failed") return { word: "failed", tone: "text-destructive", badge: "destructive" };
  const badge = task.status === "done" ? "success" : task.status === "running" ? "info" : "muted";
  return { word: task.status, tone: "text-muted-foreground", badge };
}

/** What a waiting task waits on you for, for the line under its badge: the badge already says "waiting on you". */
export function waitingDetail(waiting: NonNullable<BoardTask["waiting"]>): string {
  return waiting.kind === "review" ? "needs your review" : waiting.kind === "question" ? "has a question for you" : "needs you to act";
}

/** A task's id as people read it: `#abc123`, without the `task_` prefix every id carries. */
export const taskShortId = (id: string): string => `#${id.replace(/^task_/, "")}`;
