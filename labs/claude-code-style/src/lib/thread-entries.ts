/**
 * A thread's entries, from a session's stored items: what the main thread and
 * a task's work draw. Pure: the items come from the session feed
 * (`src/app/`), and nothing here reaches the server.
 *
 * `entriesOf` reads the items in order; `withStopped` places a line after each
 * turn you stopped; `reviewStopOf` and `reviewStopIdOf` read a coding run's
 * latest review stop; `acceptOf` is the verdict an accept sends.
 */
import { delegateAnswerOf, taskBriefOf } from "@flow-state-dev/workforce/browser";
import { parseNotice } from "@flow-state-dev/orchestration/tasks";
import { reviewDetail, type ReviewDetail } from "@flow-state-dev/harness-manager/browser";
import { isSuspensionWait, type FileContent } from "@flow-state-dev/core/items";
import type { ReviewAnswer, ReviewLand } from "../components/flow-state/review-hold";
import { resultSummary } from "./result-summary";
import { filedTaskOf, toolRun, type ToolCallOf, type ToolRun } from "./tool-steps";

/** One entry in a thread, in the order it happened, with the request it came from when known. */
export type ThreadEntry = (
  | {
      kind: "user";
      id: string;
      text: string;
      /** The files the line carries, as references, in the order attached. */
      files?: FileContent[];
      /** Threads mode: the lead's turn filed threads for this line. */
      sentToThread?: boolean;
    }
  /** What a task's session was handed: its brief, as filed or re-queued. One folded line, never your line. */
  | { kind: "brief"; id: string; text: string }
  /** `incomplete` when its turn failed before the reply was finished. */
  | { kind: "assistant"; id: string; text: string; incomplete?: boolean }
  /** A run of consecutive tool calls in one turn, in words (`toolRun`): one line that opens to a line per call. */
  | ({ kind: "tool"; id: string } & ToolRun)
  | {
      kind: "result";
      id: string;
      taskId: string;
      title: string;
      status: TaskStatus;
      summary: string;
      /** The main session took it while a turn was running (step 4). */
      duringTurn: boolean;
    }
  /** A turn you stopped: its request ended `aborted`. It follows that request's last entry. */
  | { kind: "stopped"; id: string }
  /**
   * A turn that failed, from the engine's `error` item: its reason, and `retryable` when Retry is
   * offered on it: it is the thread's newest turn, and one the engine will run again for you.
   */
  | { kind: "failed"; id: string; reason: string; code?: string; details?: Record<string, unknown>; retryable: boolean }
  /** Threads mode: a thread the lead filed, where its `createTask` call is. The card reads the task. */
  | { kind: "thread"; id: string; taskId: string }
) & { requestId?: string };

/** A task's status, as the task tools name it. */
export type TaskStatus = "pending" | "in_progress" | "held" | "completed" | "errored" | "cancelled";

/**
 * The request sources the engine retries for a caller (`PUBLIC_REENTRY_SOURCES`): a turn that came
 * in another way, such as a worker's message (`internal`) or a task's run (`task`), it refuses.
 * A copy, since the page can't import the engine; a test pins it to the engine's.
 */
export const RETRYABLE_SOURCES: ReadonlySet<string> = new Set(["http", "mcp", "scheduled"]);

/** The item types a thread draws: a failed turn's `error` item too. */
export const THREAD_ITEMS = ["message", "tool_output", "error"];

/** One stored item, as far as the thread reads it. */
export interface Item {
  id: string;
  type: string;
  role?: string;
  requestId?: string;
  agentName?: string;
  blockName?: string;
  content?: { type: string; text?: string }[];
  output?: unknown;
  /** A `suspension` item's: what it waits on, and what it carries beside its prompt. */
  kind?: string;
  data?: Record<string, unknown>;
  /** A message's data a client reads: a task's line names its task here (`parseNotice`, `delegateAnswerOf`). */
  metadata?: Record<string, unknown>;
  /** A `tool_output` item's: the call it answers, and whether it is still going or threw. */
  toolCall?: { name?: string; arguments?: string };
  status?: string;
  /** A failed `tool_output` item's error: a `SUSPENSION` one is a call waiting on you (`isSuspensionWait`). */
  error?: { code?: string };
  /** An `error` item's: why its turn failed. */
  message?: string;
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * A run's latest review stop, read with harness-manager's browser reader, or
 * undefined before it makes one. The latest wins: a run sent back for changes
 * stops for review again.
 */
export function reviewStopOf(items: readonly Item[]): ReviewDetail | undefined {
  const stop = latestReviewStop(items);
  return (stop && reviewDetail(stop.data)) ?? undefined;
}

/** The latest review stop's item, or undefined before the run makes one. */
const latestReviewStop = (items: readonly Item[]) => [...items].reverse().find((item) => item.type === "suspension" && item.kind === "review");

/**
 * The id of the latest review stop: one id per review round. A run sent back, or a landing retried,
 * stops for review again under a new id, which is how the accept tells a new round from the one it answered.
 */
export function reviewStopIdOf(items: readonly Item[]): string | undefined {
  return latestReviewStop(items)?.id;
}

/**
 * The verdict an accept sends: plain, or naming how the work lands. Without a `land` the key is
 * absent, so a plain accept on a run that can't land reads as it always did. Exported for its tests.
 */
export function acceptOf(land?: ReviewLand): ReviewAnswer {
  return land === undefined ? { verdict: "accepted" } : { verdict: "accepted", land };
}

const textOf = (item: Item) => (item.content ?? []).map((part) => part.text ?? "").join("");

/** The files a message carries: its `file` parts, references to the stored bytes. */
const filesOf = (item: Item): FileContent[] =>
  (item.content ?? []).filter(
    (part): part is FileContent => part.type === "file" && typeof (part as Partial<FileContent>).data === "string" && typeof (part as Partial<FileContent>).mediaType === "string",
  );

/** A `tool_output` item as the call it answers: its tool, its args, its status and its result. */
function callOf(item: Item): ToolCallOf {
  let args: unknown;
  try {
    args = JSON.parse(item.toolCall?.arguments ?? "{}");
  } catch {
    args = {};
  }
  const status = isSuspensionWait(item) ? "waiting" : item.status === "failed" ? "failed" : item.status === "in_progress" ? "running" : "done";
  return { id: item.id, name: item.toolCall?.name ?? item.blockName ?? "tool", args, status, ...(status === "done" ? { output: item.output } : {}) };
}

/** The task a `createTask` item filed (`filedTaskOf`, the rule its start line reads too), or undefined. */
const filedTaskOfItem = (item: Item): string | undefined => (item.type === "tool_output" ? filedTaskOf(callOf(item)) : undefined);

/**
 * A thread's entries, from its items in order. A result is the line the main session took a task's ending as,
 * and so is a delegate's answer that landed in the conversation as written (a task filed with `resultTo:
 * "conversation"`): either way the task's reply is one line, not the session's own words.
 * In threads mode (`threads`), a task the lead filed is a thread card where its `createTask` call is, and
 * your line is marked when its turn filed one. A failed turn's `error` item is a failed entry, `retryable`
 * when it is the newest turn and one of `retryableTurns` (the requests the engine will retry), and a reply
 * that turn never finished is marked incomplete.
 */
export function entriesOf(items: readonly Item[], threads = false, retryableTurns: ReadonlySet<string> = new Set()): ThreadEntry[] {
  // A turn a user's line started holds that line; a notice's own turn holds none.
  const userTurns = new Set(
    items.filter((item) => item.type === "message" && item.role === "user" && taskBriefOf(item) === undefined).map((item) => item.requestId),
  );
  const filingTurns = new Set(items.filter((item) => filedTaskOfItem(item) !== undefined).map((item) => item.requestId));
  // A turn that failed; its reply, if it never finished, is marked incomplete. Retry is offered on the newest turn only.
  const failedTurns = new Set(items.filter((item) => item.type === "error").map((item) => item.requestId));
  const entries: ThreadEntry[] = [];
  const runs = new Map<string, ToolCallOf[]>();
  for (const item of items) {
    const requestId = item.requestId;
    const filed = threads ? filedTaskOfItem(item) : undefined;
    if (filed !== undefined) {
      entries.push({ kind: "thread", id: item.id, taskId: filed, requestId });
      continue;
    }
    if (item.type === "tool_output") {
      // A call right after another of the same turn joins its run.
      const last = entries[entries.length - 1];
      const calls = last?.kind === "tool" && last.requestId === requestId ? [...runs.get(last.id)!, callOf(item)] : [callOf(item)];
      const id = calls.length > 1 ? last!.id : item.id;
      runs.set(id, calls);
      const entry: ThreadEntry = { kind: "tool", id, ...toolRun(calls), requestId };
      if (calls.length > 1) entries[entries.length - 1] = entry;
      else entries.push(entry);
      continue;
    }
    if (item.type === "error") {
      entries.push({
        kind: "failed",
        id: item.id,
        reason: item.message ?? "",
        ...(item.code === undefined ? {} : { code: item.code }),
        ...(item.details === undefined ? {} : { details: item.details }),
        retryable: false,
        requestId,
      });
      continue;
    }
    const text = textOf(item);
    // A task's brief is a `user` line for its model's history, but you never typed it.
    if (item.role === "user" && taskBriefOf(item) !== undefined) {
      entries.push({ kind: "brief", id: item.id, text, requestId });
      continue;
    }
    if (item.role === "user") {
      const files = filesOf(item);
      entries.push({
        kind: "user",
        id: item.id,
        text,
        requestId,
        ...(files.length > 0 ? { files } : {}),
        ...(threads && filingTurns.has(requestId) ? { sentToThread: true } : {}),
      });
      continue;
    }
    // A failure that runs again is not an ending; the others are the thread's own task statuses.
    const notice = parseNotice(item);
    if (notice !== undefined && notice.ending !== "retried") {
      entries.push({
        kind: "result",
        id: item.id,
        taskId: notice.taskId,
        title: notice.title,
        status: notice.ending,
        summary: resultSummary(notice.detail ?? text),
        duringTurn: userTurns.has(requestId),
        requestId,
      });
      continue;
    }
    const answer = delegateAnswerOf(item);
    if (answer !== undefined && text.length > 0) {
      // The line names who answered, by the worker's own name.
      const worker = answer.worker.split(".").pop()!;
      entries.push({ kind: "result", id: item.id, taskId: answer.taskId, title: `Answer from ${worker}`, status: "completed", summary: resultSummary(text), duringTurn: userTurns.has(requestId), requestId });
      continue;
    }
    if (text.length > 0) {
      const incomplete = failedTurns.has(requestId) && item.status !== "completed";
      entries.push({ kind: "assistant", id: item.id, text, ...(incomplete ? { incomplete: true } : {}), requestId });
    }
  }
  // The newest turn is the one that drew the last entry: an item that draws none (a retried notice,
  // an empty message) does not move it.
  const newestTurn = entries[entries.length - 1]?.requestId;
  return entries.map((entry) =>
    entry.kind === "failed" && entry.requestId !== undefined && entry.requestId === newestTurn && retryableTurns.has(entry.requestId) ? { ...entry, retryable: true } : entry,
  );
}

/**
 * A thread's entries with a `stopped` line after the last entry of each turn you stopped (`stopped`,
 * its request ids). A stopped turn with no entry in the loaded window gets no line: there is nowhere
 * true to put it.
 */
export function withStopped(entries: readonly ThreadEntry[], stopped: ReadonlySet<string>): ThreadEntry[] {
  if (stopped.size === 0) return [...entries];
  const lastOf = new Map<string, number>();
  entries.forEach((entry, at) => {
    if (entry.requestId !== undefined && stopped.has(entry.requestId)) lastOf.set(entry.requestId, at);
  });
  const after = new Map([...lastOf].map(([requestId, at]) => [at, requestId]));
  return entries.flatMap((entry, at) => {
    const requestId = after.get(at);
    return requestId === undefined ? [entry] : [entry, { kind: "stopped" as const, id: `stopped:${requestId}`, requestId }];
  });
}

