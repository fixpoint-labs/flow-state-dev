/**
 * How a task stands, in one word and one colour. A leaf the components and
 * the status line both read, so `lib/status` needn't import a component module.
 */
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import type { TaskSignalKind } from "../components/flow-state/task-signals";
import { isIdle, taskStatus } from "./task";

/** A task's word, the class that colours it as text, and the classes of its pill. */
export interface TaskPresentation {
  word: string;
  tone: string;
  pill: string;
}

/**
 * How a task stands, in one word and one colour, for every place the lab
 * draws a task: its card in the teammate's panel, its card in the
 * conversation (`TaskCard`), its popup and the worker's status line. One
 * reader, so they never disagree. The colours keep their meanings: a task
 * that waits on you is the highlighter's, and only ever as a pill (its words
 * stay grey); running is blue; done is green; failed is red, as is a run that
 * stopped answering (its time signal reads *quiet*), always with its word; an
 * idle one says what it waits on (*PR open*) inside a dashed ring; a
 * cancelled one is quiet.
 */
export function taskPresentation(task: Pick<CodingBoardTask, "status" | "asks" | "pullRequests">, signal?: TaskSignalKind): TaskPresentation {
  const status = taskStatus(task);
  if (status === "running" && task.asks.length > 0) return { word: "waiting on you", tone: "text-text-2", pill: "bg-attention text-attention-foreground" };
  if (isIdle(task)) return { word: "PR open", tone: "text-text-2", pill: "border border-dashed border-border-strong text-text-2" };
  if (signal === "quiet") return { word: "quiet", tone: "text-danger", pill: "bg-(--redbg) text-danger" };
  if (status === "failed") return { word: "failed", tone: "text-destructive", pill: "bg-(--redbg) text-destructive" };
  if (status === "running") return { word: status, tone: "text-brand", pill: "bg-(--bluebg) text-brand" };
  if (status === "done") return { word: status, tone: "text-success-text", pill: "bg-success-soft text-success-text" };
  return { word: status, tone: "text-text-3", pill: "bg-muted text-text-2" };
}
