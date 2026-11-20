/**
 * What the screen works out from one coding board row (harness-manager's
 * `CodingBoardTask`): its status in the screen's four words, who it is for,
 * what waits on you, what it runs on, its times, and what a re-run and an
 * answer send. Functions over the view's row, read with `?.` and `== null`:
 * the screen keeps no row type of its own.
 */
import { taskView, type InboxAnswer, type RefileOverrides, type TaskView } from "@flow-state-dev/orchestration/inbox";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import type { ReviewAnswer } from "../components/flow-state/review-hold";
import { durationText } from "../components/flow-state/spend";
import { harnessName } from "./harness";

/** A task's status in the screen's words: `cancelled` is its own ending, since a task someone withdrew did not fail. */
export function taskStatus(task: Pick<CodingBoardTask, "status">): "running" | "done" | "failed" | "cancelled" {
  return task.status === "completed" ? "done" : task.status === "errored" ? "failed" : task.status === "cancelled" ? "cancelled" : "running";
}

/** The worker it was filed for; none for a task filed to nobody. */
export const workerOf = (task: Pick<CodingBoardTask, "assignee">): string => task.assignee ?? "";

/** Its line's words: its title, else its goal. */
export const titleOf = (task: Pick<CodingBoardTask, "title" | "goal">): string => task.title ?? task.goal;

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

/** The row as orchestration's `taskView` reads it, with the view's own holds: its state and times, for its time signal and the counts. */
export const viewOf = (task: CodingBoardTask, board = ""): TaskView => taskView({ ...task, board } as Parameters<typeof taskView>[0], task.asks);

/** When this attempt's run started: its run link's start, else the task's own (a retry keeps its first start). */
export const attemptStartedAt = (task: Pick<CodingBoardTask, "run" | "startedAt">): number | undefined => task.run?.startedAt ?? task.startedAt;

/**
 * How long a still-active task may run before its card calls it
 * *Long-running*: a day. Elapsed time only, from this attempt's start: a task
 * open that long has almost always stalled or been forgotten, and the tag is
 * there to make someone look.
 */
export const LONG_RUNNING_MS = 24 * 60 * 60 * 1000;

/**
 * A task card's elapsed time: the registry's `durationText` ("42s", "2m 23s",
 * "1h 3m") under a day, and days and hours past it ("2d 23h"), so a stalled
 * task never reads as a plausible "71h 24m".
 */
export function elapsedText(ms: number): string {
  const hours = Math.floor(Math.max(0, ms) / 3_600_000);
  return hours < 24 ? durationText(ms) : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** It is still active (running, queued or waiting) and this attempt started more than {@link LONG_RUNNING_MS} before `now`. */
export function isLongRunning(task: Pick<CodingBoardTask, "status" | "run" | "startedAt">, now: number): boolean {
  const start = attemptStartedAt(task);
  return taskStatus(task) === "running" && start !== undefined && now - start > LONG_RUNNING_MS;
}

/** Its run's start and lease deadline, for the time signal; each absent until the row has it. */
export const runTimesOf = (task: Pick<CodingBoardTask, "run" | "leaseUntil">) => ({
  ...(typeof task.run?.startedAt === "number" ? { startedAt: task.run.startedAt } : {}),
  ...(typeof task.leaseUntil === "number" ? { leaseUntil: task.leaseUntil } : {}),
});

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
export function rerunOverrides(task: Pick<CodingBoardTask, "status" | "title" | "goal" | "harness">, context: string | undefined, worker: string): RefileOverrides {
  const ended = task.status === "cancelled" ? "was cancelled" : "failed";
  const on = harnessOf(task);
  const line = `This re-runs the task "${titleOf(task)}", which ${ended}${on === undefined ? "" : ` on ${on}`}.`;
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
