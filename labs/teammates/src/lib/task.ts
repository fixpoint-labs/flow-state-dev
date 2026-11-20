/**
 * What the screen works out from one coding board row (harness-manager's
 * `CodingBoardTask`): its status in the screen's four words, who it is for,
 * what waits on you, what it runs on, its times, and what a re-run and an
 * answer send. Functions over the view's row, read with `?.` and `== null`:
 * the screen keeps no row type of its own.
 */
import type { InboxAnswer, RefileOverrides } from "@flow-state-dev/orchestration/inbox";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { leaseLapsed } from "@flow-state-dev/orchestration/tasks";
import type { ReviewAnswer } from "../components/flow-state/review-hold";
import type { TaskSignalRun, TaskSignalView } from "../components/flow-state/task-signals";
import { harnessName } from "./harness";

/** A task's status in the screen's words: `cancelled` is its own ending, since a task someone withdrew did not fail. */
export function taskStatus(task: Pick<CodingBoardTask, "status">): "running" | "done" | "failed" | "cancelled" {
  return task.status === "completed" ? "done" : task.status === "errored" ? "failed" : task.status === "cancelled" ? "cancelled" : "running";
}

/** The worker it was filed for; none for a task filed to nobody. */
export const workerOf = (task: Pick<CodingBoardTask, "assignee">): string => task.assignee ?? "";

/** What it waits on you for while something does: its oldest open hold, as the view read it. */
export const holdOf = (task: Pick<CodingBoardTask, "asks">) => task.asks[0];

/** Its ask's kind as the screen draws it: a question, a review, or another stop. */
export function waitsFor(task: Pick<CodingBoardTask, "asks">): "question" | "review" | "other" | undefined {
  const kind = holdOf(task)?.ask.kind;
  return kind === undefined ? undefined : kind === "question" || kind === "review" ? kind : "other";
}

/** The harness a coding task runs on, by the screen's name for it; none for a teammate's task. */
export const harnessOf = (task: Pick<CodingBoardTask, "harness">): string | undefined => (task.harness == null ? undefined : harnessName(task.harness));

/** The model its run reported, when it reported one; never guessed. */
export const modelOf = (task: Pick<CodingBoardTask, "spend">): string | undefined => task.spend?.model ?? undefined;

/** When this attempt's run started: its run link's start, else the task's own (a retry keeps its first start). */
export const attemptStartedAt = (task: Pick<CodingBoardTask, "run" | "startedAt">): number | undefined => task.run?.startedAt ?? task.startedAt;

/**
 * Whether a run is on it now: it is running and holds a lease that hasn't
 * lapsed (the board's rule, `leaseLapsed`: lapsed at its deadline). A task kept
 * open, owing a turn or waiting on its pull request holds none.
 */
export const runsNow = (task: Pick<CodingBoardTask, "status" | "leaseUntil">, now: number): boolean =>
  taskStatus(task) === "running" &&
  task.leaseUntil != null &&
  !leaseLapsed({ status: "in_progress", leaseUntil: task.leaseUntil } as Parameters<typeof leaseLapsed>[0], now);

/** Whether it waits on its pull request: its run ended, and it stays open until the pull request merges or closes. */
export const waitsOnPullRequest = (task: Pick<CodingBoardTask, "status" | "pullRequests">): boolean => task.status === "in_progress" && task.pullRequests.length > 0;

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

/**
 * How long this attempt ran: from its start (the run link's, so a retry times
 * itself, not the task's first start) to when the task ended. `undefined`
 * while it runs, or when either end is missing.
 */
export function attemptDurationMs(task: Pick<CodingBoardTask, "status" | "run" | "startedAt" | "completedAt">): number | undefined {
  const start = attemptStartedAt(task);
  const end = task.completedAt;
  if (taskStatus(task) === "running" || start === undefined || end == null || end < start) return undefined;
  return end - start;
}

/**
 * What a re-run sets over the task it copies: the worker it now goes to, and
 * its brief (read whole, `context`) with one line added naming the task it
 * re-runs, by title, so the old brief is kept and the link shows.
 */
export function rerunOverrides(task: Pick<CodingBoardTask, "status" | "title" | "harness">, context: string | undefined, worker: string): RefileOverrides {
  const ended = task.status === "cancelled" ? "was cancelled" : "failed";
  const on = harnessOf(task);
  const line = `This re-runs the task "${task.title}", which ${ended}${on === undefined ? "" : ` on ${on}`}.`;
  return { assignee: worker, context: context === undefined || context === "" ? line : `${context}\n\n${line}` };
}

/**
 * Your answer to what a task waits on, as the Inbox client's answer: the
 * words to a question, or a review's verdict. An accept's `words` (the note
 * on Open a PR or Retry) go with it, so a failed landing hands them on.
 */
export function inboxAnswerOf(answer: { text: string } | ReviewAnswer): InboxAnswer {
  if ("text" in answer) return { text: answer.text };
  if (answer.verdict === "revise") return { value: { verdict: "revise", words: answer.words } };
  return { value: { verdict: "accepted", ...(answer.land === undefined ? {} : { land: answer.land }), ...(answer.words === undefined ? {} : { words: answer.words }) } };
}
