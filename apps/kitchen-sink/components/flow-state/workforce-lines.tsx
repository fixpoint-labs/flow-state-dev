"use client";

/**
 * Workforce's conversation lines, styled: a message another worker sent, a
 * message this worker sent, a task the conversation filed, a filed task's
 * ending, and a task's brief folded to one line.
 *
 * Spread {@link workforceLineRenderers} into a registry's `data` slot and
 * wrap the registry's message renderer in {@link withBrief}:
 *
 *     const renderers = {
 *       ...chatAssistantRenderers,
 *       message: withBrief(Message),
 *       data: { ...chatAssistantRenderers.data, ...workforceLineRenderers },
 *     };
 *
 * - received (`workforce:received`): under its sender's name and picture,
 *   marked when it answers a message, asks for a reply, or is the
 *   framework's "no answer".
 * - sent (`workforce:sent`): *Messaged ada*, one that asks for a reply too
 *   (the reply comes later as a message); *Asking ada…* while a waited send
 *   waits, then *Asked ada* with the answer under it; *Not sent to ada* and
 *   why when it was refused; *Not answered by ada* and why when a waited
 *   send's delivery failed. It opens the exchange (`openMessage`) and shows
 *   how it stands (`sentStatusOf`) where the screen says.
 * - task (`workforce:task`): *Filed a task for ada: …*, opening the task.
 * - result (`workforce:result`): *ada finished: …*, *couldn't finish*, *was
 *   cancelled*, opening the task.
 * - brief: the words workforce hands a worker when it starts a task are
 *   what the session was given, not words the user typed, so they fold to
 *   one *Task brief* line that opens to the message as the app draws it.
 *
 * Names, pictures and what a click opens come from the screen's line context
 * (`conversation-lines`): `nameOf`, `avatarOf`, `openMessage`, `openTask`,
 * `sentStatusOf`. Outside a provider a line shows ids and opens nothing.
 */

import type { ComponentType, ReactNode } from "react";
import type { DataItem, MessageItem } from "@flow-state-dev/core/items";
import type { ItemLine } from "@flow-state-dev/react";
import {
  FILED_TASK_DATA_TYPE,
  RECEIVED_MESSAGE_DATA_TYPE,
  SENT_MESSAGE_DATA_TYPE,
  sentTargetLabel,
  TASK_RESULT_DATA_TYPE,
  taskBriefOf,
  type FiledTaskValue,
  type ReceivedMessageValue,
  type SentMessageValue,
  type TaskResultValue,
} from "@flow-state-dev/workforce/browser";
import { ChevronRightIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useLineContext } from "./conversation-lines";
import { MarkdownText } from "./message-response";

/** The look of a line about another worker: one row, a border, the card's ground. */
const ROW = "flex w-full max-w-[85%] items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm";
/** A row that opens something. */
const OPENS = "hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring";

/** A worker's name and picture, from the screen's context; the id and no picture outside one. */
function useWorker() {
  const { nameOf, avatarOf } = useLineContext();
  return { name: (id: string) => nameOf?.(id) ?? id, avatar: (id: string): ReactNode => avatarOf?.(id) ?? null };
}

/** A row that is a button when it opens something, else a plain block. */
function Row({ label, onOpen, className, children, ...data }: { label: string; onOpen?: () => void; className: string; children: ReactNode } & Record<`data-${string}`, string>) {
  return onOpen === undefined ? (
    <div aria-label={label} className={className} {...data}>
      {children}
    </div>
  ) : (
    <button type="button" aria-label={label} onClick={onOpen} className={cn(className, OPENS)} {...data}>
      {children}
    </button>
  );
}

/** A message another worker sent this one (`workforce:received`), under its sender's name. */
export function ReceivedLine({ item }: { item: DataItem }) {
  const { name, avatar } = useWorker();
  const value = item.value as Partial<ReceivedMessageValue>;
  const from = value.from ?? "";
  const notes = [value.noAnswer ? "no answer" : value.inReplyTo !== undefined ? "reply" : null, value.replyRequested ? "asks for a reply" : null].filter((n) => n !== null);
  return (
    <section
      aria-label={`From ${name(from)}`}
      data-line="received"
      data-from={from}
      data-message-id={value.id ?? ""}
      data-reply-requested={String(value.replyRequested === true)}
      className="max-w-[85%] rounded-md border border-dashed border-info/60 bg-info/5 px-3 py-2"
    >
      <div className="flex items-center gap-1.5 font-mono text-xs tracking-widest text-info uppercase" data-part="label">
        {avatar(from)}← {name(from)}
        {notes.map((note) => ` · ${note}`).join("")}
      </div>
      <MarkdownText className="mt-0.5 text-base" text={value.text ?? ""} />
    </section>
  );
}

/** What a waited send's answer says under its line, or nothing while it waits. */
function waitAnswer(wait: SentMessageValue["wait"]): string | null {
  if (wait?.status === "answered") return wait.noAnswer === true ? "No answer came." : (wait.reply ?? "");
  if (wait?.status === "running") {
    return wait.recipient === "waiting_on_person"
      ? "No answer by the deadline: it waits on the user. The answer comes as a message."
      : "No answer by the deadline yet. The answer comes as a message.";
  }
  return null;
}

/** A message this worker sent (`workforce:sent`), refused and failed ones too. */
export function SentLine({ item }: { item: DataItem }) {
  const { openMessage, sentStatusOf } = useLineContext();
  const { name, avatar } = useWorker();
  const value = item.value as Partial<SentMessageValue>;
  // A worker by its name; a task or a conversation in workforce's words.
  const worker = typeof value.to === "string" ? value.to : undefined;
  const to = worker === undefined ? sentTargetLabel(value.to) : name(worker);
  const text = value.text ?? "";
  const messageId = value.messageId;
  // A waited send's line is written before the message has an id, and again if the wait fails: its wait says how it stands.
  const state =
    value.refused !== undefined ? "refused" : value.wait?.status === "waiting" ? "waiting" : value.wait?.status === "failed" ? "failed" : messageId === undefined ? "refused" : "sent";
  const said =
    state === "refused" ? `Not sent to ${to}` : state === "waiting" ? `Asking ${to}…` : state === "failed" ? `Not answered by ${to}` : value.wait !== undefined ? `Asked ${to}` : `Messaged ${to}`;
  const answer = state === "sent" ? waitAnswer(value.wait) : null;
  const reason = state === "refused" ? value.refused : state === "failed" ? value.wait?.error : undefined;
  const status = messageId === undefined ? undefined : sentStatusOf?.(messageId);
  // Only a message that went to a worker, and has its id, has an exchange to open.
  const opens = state !== "refused" && worker !== undefined && messageId !== undefined && openMessage !== undefined ? () => openMessage({ to: worker, messageId, text }) : undefined;
  return (
    <Row
      label={`${said}: ${text}`}
      onOpen={opens}
      data-line="sent"
      data-to={worker ?? to}
      data-state={state}
      {...(messageId === undefined ? {} : { "data-message-id": messageId })}
      className={cn(ROW, "flex-wrap border-border bg-card/60")}
    >
      {worker === undefined ? null : avatar(worker)}
      <span className={cn("shrink-0", state === "refused" || state === "failed" ? "text-destructive" : undefined)}>{said}:</span>{" "}
      {/* Cut to the line when a click opens the whole exchange; else these words are all there is, so they wrap. */}
      <span className={cn("min-w-0 flex-1 text-muted-foreground", opens === undefined ? "whitespace-pre-wrap break-words" : "truncate")} data-part="text">
        {text}
      </span>
      {status === undefined ? null : (
        <span className="shrink-0 text-xs text-muted-foreground" data-sent-status>
          {status}
        </span>
      )}
      {answer === null ? null : (
        <span className="w-full whitespace-pre-wrap" data-part="answer">
          {answer}
        </span>
      )}
      {reason === undefined ? null : (
        <span className="w-full text-xs text-muted-foreground" data-part="reason">
          {reason}
        </span>
      )}
    </Row>
  );
}

/** A task the conversation filed (`workforce:task`), opening the task. */
export function TaskLine({ item }: { item: DataItem }) {
  const { openTask } = useLineContext();
  const { name, avatar } = useWorker();
  const value = item.value as Partial<FiledTaskValue>;
  const said = value.assignee === undefined ? "Filed a task" : `Filed a task for ${name(value.assignee)}`;
  const taskId = value.taskId;
  return (
    <Row
      label={`${said}: ${value.title ?? ""}`}
      onOpen={taskId === undefined || openTask === undefined ? undefined : () => openTask(taskId)}
      data-line="task"
      data-task-id={taskId ?? ""}
      className={cn(ROW, "border-border bg-card/60")}
    >
      {value.assignee === undefined ? null : avatar(value.assignee)}
      <span className="shrink-0">{said}:</span>{" "}
      <span className="min-w-0 flex-1 truncate">{value.title}</span>
    </Row>
  );
}

/** A task the conversation filed ended (`workforce:result`): one line under the worker that ran it, opening the task. */
export function ResultLine({ item }: { item: DataItem }) {
  const { openTask } = useLineContext();
  const { name, avatar } = useWorker();
  const value = item.value as Partial<TaskResultValue>;
  const from = value.from ?? "";
  const failed = value.ending === "errored";
  const cancelled = value.ending === "cancelled";
  const said = `${from === "" ? "The task" : name(from)} ${failed ? "couldn't finish" : cancelled ? "was cancelled" : "finished"}: ${value.title ?? ""}`;
  const taskId = value.taskId;
  return (
    <Row
      label={said}
      onOpen={taskId === undefined || openTask === undefined ? undefined : () => openTask(taskId)}
      data-line="result"
      data-task-id={taskId ?? ""}
      data-status={failed ? "failed" : cancelled ? "cancelled" : "done"}
      className={cn(ROW, "border-dashed border-success/60 bg-success/5")}
    >
      {from === "" ? null : avatar(from)}
      <span className={cn("min-w-0 truncate", failed && "text-destructive")}>{said}</span>
      {/* What it came back with, cut to the line; the whole of it is the task's. */}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{value.text}</span>
    </Row>
  );
}

/** Whether a message item is a task's brief rather than a line someone wrote. */
export function isTaskBrief(item: { type: string; metadata?: Readonly<Record<string, unknown>> }): boolean {
  return item.type === "message" && taskBriefOf(item) !== undefined;
}

type MessageRenderer = ComponentType<{ item: MessageItem; line?: ItemLine }>;

/**
 * A `message` renderer that folds a task's brief to one *Task brief* line,
 * opening to the brief as `Message` draws it; every other message is
 * `Message`'s. Call it once, at module level, beside the registry.
 */
export function withBrief(Message: MessageRenderer): MessageRenderer {
  return function MessageOrBrief({ item, line }) {
    if (!isTaskBrief(item)) return <Message item={item} {...(line === undefined ? {} : { line })} />;
    return (
      <Collapsible className="group/brief not-prose w-full" data-line="brief">
        <CollapsibleTrigger className="inline-flex max-w-full items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground">
          <span className="truncate">Task brief</span>
          <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/brief:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-1.5 ml-1 border-l pl-3 text-muted-foreground outline-none">
          <Message item={item} {...(line === undefined ? {} : { line })} />
        </CollapsibleContent>
      </Collapsible>
    );
  };
}

/**
 * Workforce's lines for a registry's `data` slot, by `dataType`. Keep the
 * registry at module level, not built per render.
 */
export const workforceLineRenderers: Readonly<Record<string, ComponentType<{ item: DataItem }>>> = {
  [RECEIVED_MESSAGE_DATA_TYPE]: ReceivedLine,
  [SENT_MESSAGE_DATA_TYPE]: SentLine,
  [FILED_TASK_DATA_TYPE]: TaskLine,
  [TASK_RESULT_DATA_TYPE]: ResultLine,
};
