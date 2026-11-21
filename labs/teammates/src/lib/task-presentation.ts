/**
 * How a task stands, in one word and one colour. A leaf the components and
 * the status line both read, so `lib/status` needn't import a component module.
 */
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import type { TaskSignalKind } from "../components/flow-state/task-signals";
import { isIdle, taskStatus } from "./task";

/** A task's word and the class that colours it. */
export interface TaskPresentation {
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
 * failed one is red; an idle one says what it waits on (*PR open*, else
 * *idle*); the rest are quiet.
 */
export function taskPresentation(task: Pick<CodingBoardTask, "status" | "state" | "asks" | "pullRequests">, signal?: TaskSignalKind): TaskPresentation {
  const status = taskStatus(task);
  if (status === "running" && task.asks.length > 0) return { word: "waiting on you", tone: "text-attention" };
  if (isIdle(task)) return { word: task.pullRequests.length > 0 ? "PR open" : "idle", tone: "text-muted-foreground" };
  if (signal === "quiet") return { word: "quiet", tone: "text-warning" };
  if (status === "failed") return { word: "failed", tone: "text-destructive" };
  return { word: status, tone: "text-muted-foreground" };
}
