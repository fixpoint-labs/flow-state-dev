/**
 * The line under a teammate's name: what it is doing right now, from real
 * state only. It is answering in its conversation (a running request), a
 * coding task it started is running (the board's row), it sent a message and
 * waits for the reply (the message log), or it is idle. Nothing is guessed:
 * with no request, no running task and no open message, it is idle.
 */
import type { Activity, BoardTask, ConversationEntry, LabAdapter, TalkRow, WorkerRow } from "../adapter";
import { waitingOn } from "./talk";
import { age, useNow, useWatch } from "./use-watch";

/** Everything the line is read from. */
export interface StatusInputs {
  activity: Activity | undefined;
  entries: readonly ConversationEntry[];
  talk: readonly TalkRow[];
  tasks: readonly BoardTask[];
  now: number;
}

/**
 * The status line, in plain words: "Replying to you", "Replying to researcher",
 * "Running coding task: X", "Messaging writer", or "Idle".
 */
export function statusLine(worker: string, { activity, entries, talk, tasks, now }: StatusInputs, nameOf: (id: string) => string, isCoding: (id: string) => boolean): string {
  if (activity?.running) {
    // What it is answering: the last line it was given, yours or another worker's.
    const given = [...entries].reverse().find((e) => e.kind === "user" || e.kind === "received");
    return given?.kind === "received" ? `Replying to ${nameOf(given.from)}` : "Replying to you";
  }
  const coding = tasks.find((t) => t.status === "running" && isCoding(t.to));
  if (coding) return `Running coding task: ${coding.title}`;
  const waiting = waitingOn(worker, [...talk]);
  if (waiting.length > 0) return `Messaging ${waiting.map(nameOf).join(", ")}`;
  if (activity === undefined) return "";
  return activity.lastActiveAt > 0 ? `Idle · ${age(activity.lastActiveAt, now)}` : "Idle";
}

/** A teammate's status line, live. */
export function useStatusLine(adapter: LabAdapter, worker: WorkerRow, sessionId: string | undefined, nameOf: (id: string) => string, isCoding: (id: string) => boolean): string {
  const now = useNow();
  const activity = useWatch(adapter.watchActivity, worker.id);
  const talk = useWatch(adapter.watchTalk, worker.id) ?? [];
  const view = useWatch(adapter.watchConversation, sessionId);
  const tasks = useWatch(adapter.watchTasks, sessionId) ?? [];
  return statusLine(worker.id, { activity, entries: view?.entries ?? [], talk, tasks, now }, nameOf, isCoding);
}
