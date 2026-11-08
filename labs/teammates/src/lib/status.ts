/**
 * The line under a teammate's name: what it is doing right now, from real
 * state only. First, anything it needs from you: an approval it asked for and
 * you haven't answered, or a task of its that waits on you. Then it is
 * answering in its conversation (a running request), a coding task it
 * started is running (the board's row), a coding task of its just ended (for
 * two minutes after), it sent a message and waits for the reply (the message
 * log), or it is idle. Nothing is guessed: with no request, no running task
 * and no open message, it is idle.
 */
import type { Activity, BoardTask, ConversationEntry, LabAdapter, LabTalk, LabWorker } from "../adapter";
import { taskPresentation } from "./task-presentation";
import { owedRepliesFrom } from "./talk";
import { age, useNow, useWatch } from "./use-watch";

/** Everything the line is read from. */
export interface StatusInputs {
  activity: Activity | undefined;
  entries: readonly ConversationEntry[];
  talk: readonly LabTalk[];
  tasks: readonly BoardTask[];
  now: number;
}

/** How long a coding task's ending stays on the line: long enough for a glance; the panel keeps it after. */
export const ENDING_SHOWN_MS = 2 * 60_000;

/** An approval's tone: the attention colour, a person must act. A task's tone is `taskPresentation`'s. */
const NEEDS_OK = "text-attention";
/** The quiet tone of every other line. */
const PLAIN = "text-muted-foreground";

/** The line, and the class that colours it: a task's from `taskPresentation`, an approval's the attention colour. */
export interface Status {
  text: string;
  tone: string;
  /** It asks you to act: an approval, or a task waiting on you. */
  needsYou: boolean;
}

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** An approval it asked for that you haven't answered yet. */
const openApproval = (e: ConversationEntry): boolean => e.kind === "approval" && e.resolution === undefined;

/** One thing a teammate needs from you: its key (one per approval, or per hold of a task, for the notifier), what it asks, and, for a task, the task. */
export type Need = { key: string; text: string } & ({ kind: "approval" } | { kind: "task"; task: BoardTask });

/**
 * What a teammate needs from you, oldest first: each open approval, then each
 * task that waits on you. The one rule for "needs you": the status line, the
 * row's badge, the tab's title and the notifications all read it.
 */
export function needsOf({ entries, tasks }: Pick<StatusInputs, "entries" | "tasks">): Need[] {
  return [
    ...entries.flatMap((e): Need[] => (e.kind === "approval" && openApproval(e) ? [{ key: `approval:${e.suspensionId}`, text: e.text, kind: "approval" }] : [])),
    ...tasks.flatMap((t): Need[] => (t.status === "running" && t.waiting !== undefined ? [{ key: `waiting:${t.id}:${t.waiting.holdId ?? ""}`, text: t.waiting.prompt, kind: "task", task: t }] : [])),
  ];
}

/** When a task ended, as its row's view reads it; absent while it runs, or when the row says nothing. */
export const endedAt = (t: BoardTask): number | undefined => t.view?.times.completedAt ?? undefined;

/** The coding tasks that ended (done or failed) in the last {@link ENDING_SHOWN_MS}, newest first. */
export function freshEndings(tasks: readonly BoardTask[], now: number, isCoding: (id: string) => boolean): BoardTask[] {
  return tasks
    .flatMap((task) => {
      const at = endedAt(task);
      return (task.status === "done" || task.status === "failed") && isCoding(task.to) && at !== undefined && now - at < ENDING_SHOWN_MS ? [{ task, at }] : [];
    })
    .sort((a, b) => b.at - a.at)
    .map(({ task }) => task);
}

/**
 * The status line, in plain words, and its tone: "Needs your OK: …",
 * "Waiting on you: …", "Replying to you", "Replying to researcher",
 * "Running coding task: X", "Coding task finished: X", "Coding task
 * failed: X", "Messaging writer", or "Idle".
 */
export function statusOf(worker: string, inputs: StatusInputs, nameOf: (id: string) => string, isCoding: (id: string) => boolean): Status {
  const { activity, entries, talk, tasks, now } = inputs;
  const need = needsOf(inputs)[0];
  if (need?.kind === "approval") return { text: `Needs your OK: ${need.text}`, tone: NEEDS_OK, needsYou: true };
  if (need?.kind === "task") {
    const state = taskPresentation(need.task);
    return { text: `${upperFirst(state.word)}: ${need.text}`, tone: state.tone, needsYou: true };
  }
  const plain = (text: string): Status => ({ text, tone: PLAIN, needsYou: false });
  if (activity?.running) {
    // What it is answering: the last line it was given, yours or another worker's.
    const given = [...entries].reverse().find((e) => e.kind === "user" || e.kind === "received");
    return plain(given?.kind === "received" ? `Replying to ${nameOf(given.from)}` : "Replying to you");
  }
  const coding = tasks.find((t) => t.status === "running" && isCoding(t.to));
  if (coding) return plain(`Running coding task: ${coding.title}`);
  const ended = freshEndings(tasks, now, isCoding)[0];
  if (ended) {
    const state = taskPresentation(ended);
    return { text: `Coding task ${ended.status === "failed" ? state.word : "finished"}: ${ended.title}`, tone: state.tone, needsYou: false };
  }
  const waiting = owedRepliesFrom(worker, [...talk]);
  if (waiting.length > 0) return plain(`Messaging ${waiting.map(nameOf).join(", ")}`);
  if (activity === undefined) return plain("");
  return plain(activity.lastActiveAt > 0 ? `Idle · ${age(activity.lastActiveAt, now)}` : "Idle");
}

/** A teammate's status line, its words alone, live. Its age holds while `stale`. */
export function useStatusLine(adapter: LabAdapter, worker: LabWorker, sessionId: string | undefined, nameOf: (id: string) => string, isCoding: (id: string) => boolean, stale = false): string {
  const now = useNow(undefined, !stale);
  const activity = useWatch(adapter.watchActivity, worker.id);
  const talk = useWatch(adapter.watchTalk, worker.id) ?? [];
  const view = useWatch(adapter.watchConversation, sessionId);
  const tasks = useWatch(adapter.watchTasks, sessionId) ?? [];
  return statusOf(worker.id, { activity, entries: view?.entries ?? [], talk, tasks, now }, nameOf, isCoding).text;
}
