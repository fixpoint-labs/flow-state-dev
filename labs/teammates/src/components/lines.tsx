/**
 * How the lab draws a conversation's lines: React's conversation model
 * (`conversationLines`) decides what each line is, and this file's renderers,
 * one per kind, decide how it looks. Workforce's own line types (a message
 * sent, one received, a task filed, a task's ending) draw through the
 * registry's `data` slot, the lab's look over workforce's
 * (`{ ...workforceRenderers, ...lab }`), so a line type the lab has no look
 * for still draws as workforce draws it.
 *
 * Your lines sit on the right; the worker's answers on the left, as Markdown,
 * marked incomplete when their turn failed or was stopped first. A message
 * the worker sent another is one line, "Messaged researcher", that opens the
 * exchange; one it couldn't send says so, and why. A message it received
 * lands under the sender's name. A task it filed is its card, from the
 * board's task once that is read. A task coming back is one line,
 * "researcher finished: …", that opens the task. A run of tool calls is one
 * line that is open while it runs. A failed turn is the registry's
 * `request-recovery` line with its reason, and Retry when the model offers
 * it and nothing runs; a stopped turn is its stopped line. A worker that
 * waits for your yes is a card with Approve and Deny until you answer.
 *
 * What a line needs from the screen around it (names, looks, the board's
 * tasks, opening a popup, Retry) comes from {@link LineContext}: outside a
 * conversation (a popup) the defaults draw the line and offer no action.
 */
import { createContext, memo, useContext, type ReactNode } from "react";
import type { DataItem, ErrorItem, FileContent, MessageItem, SuspensionItem } from "@flow-state-dev/core/items";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { ItemsRenderer, useApproval, type ItemLine, type RendererRegistry } from "@flow-state-dev/react";
import {
  FILED_TASK_DATA_TYPE,
  RECEIVED_MESSAGE_DATA_TYPE,
  SENT_MESSAGE_DATA_TYPE,
  TASK_RESULT_DATA_TYPE,
  type FiledTaskValue,
  type ReceivedMessageValue,
  type SentMessageTarget,
  type SentMessageValue,
  type TaskResultValue,
} from "@flow-state-dev/workforce/browser";
import { workforceRenderers } from "@flow-state-dev/workforce/react";
import { lookOf as defaultLookOf, type Look } from "../lib/looks";
import { workerOf } from "../lib/task";
import { Avatar } from "./Avatar";
import type { AnswerStatus } from "./Popups";
import { MessageFiles } from "./flow-state/message";
import { MarkdownText } from "./flow-state/message-response";
import { RequestRecovery } from "./flow-state/request-recovery";
import { TaskCard } from "./TaskCard";
import { stepsOf, ToolRun } from "./ToolRun";

/** What a line needs from the screen it is drawn on. Every field has a default that draws the line with no action. */
export interface LineScreen {
  /** The worker whose conversation it is, by name. */
  workerName: string;
  nameOf: (id: string) => string;
  /** A teammate's icon and color, the same as in the list. */
  lookOf: (id: string) => Look;
  /** The worker coding tasks run on: its results are the task's, not a teammate's. */
  isCoding: (id: string) => boolean;
  /** A coding worker's harness, for a filed task's card before the board's task arrives. */
  harnessOf: (id: string) => string | undefined;
  /** The board's tasks: a filed task's card draws from the board's task once it is read. */
  tasks: readonly CodingBoardTask[];
  /** How a message the worker sent stands, by its id; `undefined` shows none. */
  answerOf: (messageId: string) => AnswerStatus | undefined;
  /** Open the exchange a sent message started. */
  openMessage?: (sent: { to: string; messageId: string; text: string }) => void;
  /** Open a task's popup. */
  openTask?: (taskId: string) => void;
  /** Run a failed turn again; given only while nothing runs. */
  retry?: (requestId: string) => Promise<void>;
  /** The background work still running, for the stopped line that may say it. */
  stillRunning: (lineId: string) => number | undefined;
  /** Show where the conversation's tasks are listed. */
  viewTasks?: () => void;
  /** Reads the bytes of a file your line carries, for its thumbnail. */
  readFile?: (file: FileContent) => Promise<Blob>;
}

/** A screen that offers no action on a line: a popup's, and the default. */
export const quietScreen: LineScreen = {
  workerName: "The worker",
  nameOf: (id) => id,
  lookOf: (id) => defaultLookOf({ id, name: id }),
  isCoding: () => false,
  harnessOf: () => undefined,
  tasks: [],
  answerOf: () => undefined,
  stillRunning: () => undefined,
};

/** The screen a line is drawn on; the default ({@link quietScreen}) draws it with no action. */
export const LineContext = createContext<LineScreen>(quietScreen);

/** A message's words: its text parts, joined. */
export const textOf = (item: MessageItem): string => item.content.map((part) => ("text" in part && typeof part.text === "string" ? part.text : "")).join("");

/** The files a message carries: its `file` parts, references to the stored bytes. */
export const filesOf = (item: MessageItem): FileContent[] => item.content.filter((part): part is FileContent => part.type === "file");

/** What you said, and what the worker said. */
function MessageLine({ item, line }: { item: MessageItem; line?: ItemLine }) {
  const { readFile } = useContext(LineContext);
  if (line?.kind === "user") {
    const files = filesOf(item);
    const text = textOf(item);
    return (
      <div className="flex flex-col items-end gap-1.5">
        {files.length > 0 ? <MessageFiles files={files} readFile={readFile} /> : null}
        {/* A line of files alone has no words to box. */}
        {text !== "" || files.length === 0 ? (
          <div className="max-w-[80%] rounded-lg bg-accent px-4 py-2.5 text-base whitespace-pre-wrap" data-entry="user">
            {text}
          </div>
        ) : null}
      </div>
    );
  }
  const incomplete = line?.kind === "assistant" && line.incomplete === true;
  return (
    <div className="py-1 text-base" data-entry="assistant" data-incomplete={incomplete ? "true" : undefined}>
      <MarkdownText text={textOf(item)} />
      {incomplete ? <span className="mt-1 block text-xs text-muted-foreground">Incomplete</span> : null}
    </div>
  );
}

/** A turn that failed: its reason under the worker's name, and Retry when the model offers it and the screen can run it. */
function FailedLine({ item, line }: { item: ErrorItem; line?: ItemLine }) {
  const { workerName, retry } = useContext(LineContext);
  const offered = line?.kind === "failed" && line.retryable && retry !== undefined;
  return (
    <div data-entry="failed">
      <RequestRecovery who={workerName} reason={item.message} code={item.code} details={item.details} {...(offered ? { onRetry: () => retry(item.requestId) } : {})} />
    </div>
  );
}

/** A turn you stopped, after its last line. */
function StoppedLine({ line }: { line: ItemLine }) {
  const { stillRunning, viewTasks } = useContext(LineContext);
  return (
    <div data-entry="stopped">
      <RequestRecovery stopped stillRunning={stillRunning(line.id)} onView={viewTasks} />
    </div>
  );
}

/** What a worker waits on you for: Approve and Deny, until answered; then how. Any other wait is the task popup's. */
function ApprovalLine({ item, line }: { item: SuspensionItem; line?: ItemLine }) {
  const { workerName } = useContext(LineContext);
  const resolution = line?.kind === "suspension" ? line.resolution : undefined;
  const { error, isResolving: busy, approve, reject } = useApproval(item, { isResolved: resolution !== undefined });
  if (item.reason !== "user_approval") return null;
  return (
    <section aria-label={`${workerName} asks`} data-entry="approval" className="max-w-[85%] rounded-md border border-attention bg-attention/10 px-3 py-2 text-sm">
      <div className="font-mono text-xs tracking-widest text-attention uppercase">{workerName} asks · {resolution ?? "waiting for you"}</div>
      <p className="mt-0.5 whitespace-pre-wrap">{item.message}</p>
      {resolution === undefined ? (
        <div className="mt-2 flex gap-2 text-xs">
          <button type="button" disabled={busy} onClick={approve} className="rounded-sm bg-primary px-2 py-1 font-semibold text-primary-foreground disabled:opacity-40">
            Approve
          </button>
          <button type="button" disabled={busy} onClick={reject} className="rounded-sm border border-border px-2 py-1 hover:bg-accent disabled:opacity-40">
            Deny
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** One turn's tool calls, as one run. */
function StepsLine({ items, line }: { items: readonly { type: string }[]; line: Extract<ItemLine, { kind: "steps" }> }) {
  return <ToolRun steps={stepsOf(items, line.ended === true)} />;
}

/** Who a sent message went to: a worker's id, else a task or a conversation. */
const targetOf = (to: SentMessageTarget | undefined): string | undefined => (typeof to === "string" ? to : undefined);

/** A message to another worker: one line, "Messaged researcher", that opens the exchange; one it couldn't send says why. */
function SentLine({ item }: { item: DataItem }) {
  const { nameOf, lookOf, answerOf, openMessage } = useContext(LineContext);
  const value = item.value as Partial<SentMessageValue>;
  const to = targetOf(value.to);
  const name = to === undefined ? "another conversation" : nameOf(to);
  const text = value.text ?? "";
  if (value.refused !== undefined || value.messageId === undefined) {
    return (
      <div data-entry="sent" data-state="refused" className="flex w-full max-w-[85%] flex-col rounded-md border border-border bg-card/60 px-3 py-1.5 text-sm">
        <span className="text-destructive">
          Not sent to {name}: <span className="text-muted-foreground">{text}</span>
        </span>
        {value.refused === undefined ? null : <span className="text-xs text-muted-foreground">{value.refused}</span>}
      </div>
    );
  }
  const messageId = value.messageId;
  return (
    <button
      type="button"
      aria-label={`Messaged ${name}: ${text}`}
      data-entry="sent"
      onClick={to === undefined || openMessage === undefined ? undefined : () => openMessage({ to, messageId, text })}
      className="flex w-full max-w-[85%] items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-1.5 text-left text-sm hover:bg-accent"
    >
      {to === undefined ? null : <Avatar look={lookOf(to)} size="sm" />}
      <span className="shrink-0">Messaged {name}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{text}</span>
      <span className="shrink-0 text-xs text-muted-foreground" data-sent-status>
        {answerOf(messageId)}
      </span>
    </button>
  );
}

/** A message another worker sent, under the sender's name. */
function ReceivedLine({ item }: { item: DataItem }) {
  const { nameOf, lookOf } = useContext(LineContext);
  const value = item.value as Partial<ReceivedMessageValue>;
  const from = value.from ?? "";
  return (
    <section aria-label={`From ${nameOf(from)}`} data-entry="received" className="max-w-[85%] rounded-md border border-dashed border-info/60 bg-info/5 px-3 py-2">
      <div className="flex items-center gap-1.5 font-mono text-xs tracking-widest text-info uppercase">
        <Avatar look={lookOf(from)} size="sm" />← {nameOf(from)}
        {value.noAnswer ? " · no answer" : value.inReplyTo ? " · reply" : ""}
      </div>
      <MarkdownText className="mt-0.5 text-base" text={value.text ?? ""} />
    </section>
  );
}

/** The card a filed task shows until the board's task arrives: a pending task with what the filing said. One object per item, so the memoized card skips re-renders. */
const placeholders = new WeakMap<DataItem, CodingBoardTask>();
function placeholderOf(item: DataItem, value: Partial<FiledTaskValue>, harness: string | undefined): CodingBoardTask {
  let task = placeholders.get(item);
  if (task === undefined) {
    const title = value.title ?? "";
    task = { id: value.taskId ?? "", goal: title, title, assignee: value.assignee ?? "", status: "pending", attempts: 0, asks: [], harness: harness ?? null, review: null, landed: null, error: null, pullRequests: [], runFlow: null, detail: null };
    placeholders.set(item, task);
  }
  return task;
}

/** A task the worker filed: its card, from the filing until the board's task arrives, then from that task, in the same place. */
function TaskLine({ item }: { item: DataItem }) {
  const { tasks, harnessOf, nameOf, lookOf, isCoding, openTask } = useContext(LineContext);
  const value = item.value as Partial<FiledTaskValue>;
  const task = tasks.find((t) => t.id === value.taskId) ?? placeholderOf(item, value, harnessOf(value.assignee ?? ""));
  return <TaskCard task={task} nameOf={nameOf} lookOf={lookOf} coding={isCoding(workerOf(task))} onOpen={openTask ?? (() => undefined)} />;
}

/** A task the worker filed coming back: one line, "researcher finished: Draft the post", that opens its popup. */
function ResultLine({ item }: { item: DataItem }) {
  const { nameOf, lookOf, isCoding, openTask } = useContext(LineContext);
  const value = item.value as Partial<TaskResultValue>;
  const from = value.from ?? "";
  // A coding task's result is the task's, not a teammate's.
  const coding = isCoding(from);
  const who = coding ? "Coding task" : from === "" ? "The task" : nameOf(from);
  const failed = value.ending === "errored";
  const cancelled = value.ending === "cancelled";
  const line = `${who} ${failed ? "couldn't finish" : cancelled ? "was cancelled" : "finished"}: ${value.title ?? ""}`;
  return (
    <button
      type="button"
      aria-label={line}
      data-entry="result"
      data-status={failed ? "failed" : cancelled ? "cancelled" : "done"}
      onClick={value.taskId === undefined || openTask === undefined ? undefined : () => openTask(value.taskId!)}
      className="flex w-full max-w-[85%] items-center gap-2 rounded-md border border-dashed border-success/60 bg-success/5 px-3 py-1.5 text-left text-sm hover:bg-accent"
    >
      {coding || from === "" ? (
        <span aria-hidden className="shrink-0 text-muted-foreground">
          ⚙
        </span>
      ) : (
        <Avatar look={lookOf(from)} size="sm" />
      )}
      <span className={failed ? "min-w-0 truncate text-destructive" : "min-w-0 truncate"}>{line}</span>
      {/* What it came back with, cut to the line; the whole of it is in the popup. */}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{value.text}</span>
    </button>
  );
}

/**
 * The lab's renderers, over workforce's for its line types. Module level, so
 * the registry is one object. A status, source or trace item draws nothing
 * in the lab.
 */
export const teammatesRenderers: RendererRegistry = {
  message: MessageLine,
  error: FailedLine,
  suspension: ApprovalLine,
  stopped: StoppedLine,
  status: false,
  source: false,
  block_trace: false,
  data: {
    ...workforceRenderers,
    [SENT_MESSAGE_DATA_TYPE]: SentLine,
    [RECEIVED_MESSAGE_DATA_TYPE]: ReceivedLine,
    [FILED_TASK_DATA_TYPE]: TaskLine,
    [TASK_RESULT_DATA_TYPE]: ResultLine,
  },
};

/**
 * One line, drawn through the registry the nearest `FlowProvider` holds
 * (the lab's, {@link teammatesRenderers}). Memoized: a streamed chunk redraws
 * only the line that changed.
 */
export const Line = memo(function Line({ line }: { line: ItemLine }): ReactNode {
  return <ItemsRenderer lines={[line]} toolGroupRenderer={StepsLine} />;
});
