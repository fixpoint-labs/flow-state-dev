/**
 * The line under a teammate's name: what it is doing right now, from real
 * state only. First, anything it needs from you: an approval it asked for and
 * you haven't answered, or a task of its that waits on you. Then it is
 * answering in its conversation (a running request), a coding task it
 * started is running (its task holds a live lease), a coding task of
 * its waits on its pull request, a coding task of its just ended (for
 * two minutes after), it sent a message and waits for the reply (the message
 * log), or it is idle. Nothing is guessed: with no request, no running task
 * and no open message, it is idle.
 */
import { useView, type ItemLine } from "@flow-state-dev/react";
import type { SuspensionItem, ToolOutputItem } from "@flow-state-dev/core/items";
import { RECEIVED_MESSAGE_DATA_TYPE, sessionTurnsViewRef, workerSessionsViewRef, type ListedTurn, type ListedWorkerSession, type WorkerMessageResourceState } from "@flow-state-dev/workforce/browser";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { useAppClient, useConversation, useTasks } from "../app";
import { knownToolVerbs } from "../components/flow-state/tool-grouping";
import { stepOf } from "../components/flow-state/conversation-lines";
import { attemptStartedAt, holdOf, runsNow, taskStatus, waitsOnPullRequest, workerOf } from "./task";
import { taskPresentation } from "./task-presentation";
import { owedRepliesFrom, useTalk } from "./talk";
import { age, useNow } from "./use-watch";

/** Everything the line is read from. */
export interface StatusInputs {
  /** Whether a turn runs in its default conversation, and when its last turn ended or started, in ms (0: none yet). */
  activity: { running: boolean; lastActiveAt: number } | undefined;
  /** The conversation's lines. */
  lines: readonly ItemLine[];
  talk: readonly WorkerMessageResourceState[];
  tasks: readonly CodingBoardTask[];
  now: number;
}

/** How long a coding task's ending stays on the line: long enough for a glance; the panel keeps it after. */
export const ENDING_SHOWN_MS = 2 * 60_000;

/** An approval's tone: the attention colour, you must act. A task's tone is `taskPresentation`'s. */
const NEEDS_OK = "text-attention";
/** The tone of a line that only reports (replying, idle), not a task's state or something you owe. */
export const PLAIN = "text-muted-foreground";

/** The line, and the class that colours it: a task's from `taskPresentation`, an approval's the attention colour. */
export interface Status {
  text: string;
  tone: string;
  /** It asks you to act: an approval, or a task waiting on you. */
  needsYou: boolean;
}

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** An approval it asked for that you haven't answered yet. */
const openApproval = (line: ItemLine): line is Extract<ItemLine, { kind: "suspension" }> =>
  line.kind === "suspension" && line.item.reason === "user_approval" && line.resolution === undefined;

/** One thing a teammate needs from you: its key (one per approval, or per hold of a task, for the notifier), what it asks, and, for a task, the task. */
export type Need = { key: string; text: string } & ({ kind: "approval" } | { kind: "task"; task: CodingBoardTask });

/**
 * What a teammate needs from you, oldest first: each open approval, then each
 * task that waits on you. The one rule for "needs you": the status line, the
 * row's badge, the tab's title and the notifications all read it.
 */
export function needsOf({ lines, tasks }: Pick<StatusInputs, "lines" | "tasks">): Need[] {
  return [
    ...lines.flatMap((line): Need[] => (openApproval(line) ? [{ key: `approval:${line.item.suspensionId}`, text: (line.item as SuspensionItem).message, kind: "approval" }] : [])),
    ...tasks.flatMap((t): Need[] => {
      const hold = holdOf(t);
      return taskStatus(t) === "running" && hold !== undefined ? [{ key: `waiting:${t.id}:${hold.id}`, text: hold.ask.prompt, kind: "task", task: t }] : [];
    }),
  ];
}

/** When a task ended, as its row reads it; absent while it runs, or when the row says nothing. */
export const endedAt = (t: Pick<CodingBoardTask, "completedAt">): number | undefined => t.completedAt ?? undefined;

/** The coding tasks that ended (done or failed) in the last {@link ENDING_SHOWN_MS}, newest first. */
export function freshEndings(tasks: readonly CodingBoardTask[], now: number, isCoding: (id: string) => boolean): CodingBoardTask[] {
  return tasks
    .flatMap((task) => {
      const at = endedAt(task);
      return (task.status === "completed" || task.status === "errored") && isCoding(workerOf(task)) && at !== undefined && now - at < ENDING_SHOWN_MS ? [{ task, at }] : [];
    })
    .sort((a, b) => b.at - a.at)
    .map(({ task }) => task);
}

/**
 * The status line, in plain words, and its tone: "Needs your OK: …",
 * "Waiting on you: …", "Replying to you", "Replying to researcher",
 * "Running coding task: X", "Running 3 tasks · X" (X the newest; only while a
 * run holds its lease), "Waiting on its pull request: X", "Coding task
 * finished: X", "Coding task
 * failed: X", "Messaging writer", or "Idle".
 */
export function statusOf(worker: string, inputs: StatusInputs, nameOf: (id: string) => string, isCoding: (id: string) => boolean): Status {
  const { activity, lines, talk, tasks, now } = inputs;
  const need = needsOf(inputs)[0];
  if (need?.kind === "approval") return { text: `Needs your OK: ${need.text}`, tone: NEEDS_OK, needsYou: true };
  if (need?.kind === "task") {
    const state = taskPresentation(need.task);
    return { text: `${upperFirst(state.word)}: ${need.text}`, tone: state.tone, needsYou: true };
  }
  const plain = (text: string): Status => ({ text, tone: PLAIN, needsYou: false });
  if (activity?.running) {
    // What it is answering: the last line it was given, yours or another worker's.
    const given = [...lines].reverse().find((line) => line.kind === "user" || (line.kind === "data" && line.item.dataType === RECEIVED_MESSAGE_DATA_TYPE));
    const from = given?.kind === "data" ? (given.item.value as { from?: string })?.from : undefined;
    return plain(from !== undefined ? `Replying to ${nameOf(from)}` : "Replying to you");
  }
  // Running only while a run holds its lease: a task kept open with no run on it claims nothing.
  // The newest running task names the line: an old one left running must not hide the one you just started.
  const coding = tasks.filter((t) => runsNow(t, now) && isCoding(workerOf(t))).sort((a, b) => (attemptStartedAt(b) ?? 0) - (attemptStartedAt(a) ?? 0));
  if (coding.length === 1) return plain(`Running coding task: ${coding[0]!.title}`);
  if (coding.length > 1) return plain(`Running ${coding.length} tasks · ${coding[0]!.title}`);
  const merging = tasks.find((t) => waitsOnPullRequest(t) && isCoding(workerOf(t)));
  if (merging) return plain(`Waiting on its pull request: ${merging.title}`);
  const ended = freshEndings(tasks, now, isCoding)[0];
  if (ended) {
    const state = taskPresentation(ended);
    return { text: `Coding task ${ended.status === "errored" ? state.word : "finished"}: ${ended.title}`, tone: state.tone, needsYou: false };
  }
  const waiting = owedRepliesFrom(worker, [...talk]);
  if (waiting.length > 0) return plain(`Messaging ${waiting.map(nameOf).join(", ")}`);
  if (activity === undefined) return plain("");
  return plain(activity.lastActiveAt > 0 ? `Idle · ${age(activity.lastActiveAt, now)}` : "Idle");
}

/**
 * How far an answer has got, for the line under the conversation while it
 * answers: the tool step under way at the conversation's tail, in the
 * registry's words ("reading a file"), or "waiting on you" for a call parked
 * on your approval or answer. `undefined` when the tail is no run of steps or
 * none of its steps is under way; the line then just says it is answering.
 * The header's line ({@link statusOf}) says whom it answers; this says what it
 * is doing for them. Only the registry's phrases are shown: an unknown tool
 * name may itself carry a payload, so it reads "using a tool".
 */
export function answeringStep(lines: readonly ItemLine[]): Status | undefined {
  // Only the tail can describe current work. Never revive a tool from an earlier turn.
  const last = lines[lines.length - 1];
  if (last?.kind !== "steps") return undefined;
  for (let i = last.items.length - 1; i >= 0; i--) {
    const item = last.items[i]!;
    if (item.type !== "tool_output") continue;
    const step = stepOf(item as ToolOutputItem, last.ended === true);
    if (step.state === "waiting") return { text: "waiting on you", tone: NEEDS_OK, needsYou: true };
    if (step.state === "running") return { text: knownToolVerbs(step.tool)?.present ?? "using a tool", tone: PLAIN, needsYou: false };
  }
  return undefined;
}

/**
 * Whether a worker is busy, from workforce's views: a turn running in its
 * default conversation (the worker sessions view), and when its last turn
 * ended (completed, failed or aborted), else started (the session turns view, whose turns leave the board's
 * passes out). Never the session's `updatedAt`, which a board pass moves.
 * Idle with no default conversation yet; `undefined` until the reads land.
 */
export function activityOf(sessions: readonly ListedWorkerSession[] | undefined, turns: readonly ListedTurn[] | undefined): StatusInputs["activity"] {
  if (sessions === undefined) return undefined;
  const conversation = sessions.find((s) => s.isDefault);
  if (conversation === undefined) return { running: false, lastActiveAt: 0 };
  if (turns === undefined) return undefined;
  const last = turns.at(-1);
  return { running: conversation.running, lastActiveAt: last === undefined ? 0 : (last.endedAt ?? last.startedAt) };
}

/** {@link activityOf}, live, for `worker`. */
export function useActivity(worker: string): StatusInputs["activity"] {
  const { client, pollIntervalMs } = useAppClient();
  const sessions = useView(workerSessionsViewRef(), { worker }, { client, pollIntervalMs }).value;
  const conversation = sessions?.find((s) => s.isDefault);
  const turns = useView(sessionTurnsViewRef(), { sessionId: conversation?.id ?? "" }, { client, pollIntervalMs, enabled: conversation !== undefined }).value;
  return activityOf(sessions, turns);
}

/** A teammate's status line, live, with its tone and whether it asks you to act. Its age holds while `stale`. */
export function useStatus(worker: string, sessionId: string | undefined, nameOf: (id: string) => string, isCoding: (id: string) => boolean, stale = false): Status {
  const now = useNow(undefined, !stale);
  const activity = useActivity(worker);
  const talk = useTalk(worker) ?? [];
  const view = useConversation(sessionId)?.view;
  const tasks = useTasks(sessionId).value ?? [];
  return statusOf(worker, { activity, lines: view?.lines ?? [], talk, tasks, now }, nameOf, isCoding);
}
