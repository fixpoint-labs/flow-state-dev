/**
 * How the lab draws a conversation's lines: React's conversation model
 * (`conversationLines`) decides what each line is, and the UI registry's
 * `conversation-lines` and `workforce-lines` copies draw it, configured by
 * the screen's line context. The lab keeps only what is its own: your lines
 * and the worker's answers as bubbles (a task's brief folded over them), and
 * a filed task as its live card, from the board's task once that is read.
 *
 * A teammate shows by its name and avatar; the worker coding tasks run on
 * shows as a coding task, under a gear ({@link linesNames}). Outside a
 * conversation (a popup) the lines draw with no action.
 */
import { memo, useMemo, useState, type ReactNode } from "react";
import type { DataItem, FileContent, MessageItem, SuspensionItem } from "@flow-state-dev/core/items";
import { suspendForUserKindOf } from "@flow-state-dev/core/types";
import { codingBoardViewRef, type CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { ItemsRenderer, useFlowContext, useView, type ItemLine, type RendererRegistry } from "@flow-state-dev/react";
import {
  FILED_TASK_DATA_TYPE,
  RECEIVED_MESSAGE_DATA_TYPE,
  TASK_RESULT_DATA_TYPE,
  rosterView,
  type FiledTaskValue,
  type ReceivedMessageValue,
  type RosterEntry,
  type TaskResultValue,
} from "@flow-state-dev/workforce/browser";
// The provider and not the app's index: the read model draws its lines with this registry.
import { useAppClient } from "../app/provider";
import type { Look } from "../lib/looks";
import { settingOf, takesTasks } from "../lib/roster";
import { useStale } from "../lib/now";
import { workerOf } from "../lib/task";
import { Avatar } from "./Avatar";
import { ApprovalLine, CompactSteps, conversationLineRenderers, useLineContext, type LineContextValue } from "./flow-state/conversation-lines";
import { MessageFiles } from "./flow-state/message";
import { MarkdownText } from "./flow-state/message-response";
import { withBrief, workforceLineRenderers } from "./flow-state/workforce-lines";
import { TaskCard } from "./TaskCard";
import {
  WorkerReplyCollapsibleBody,
  WorkerReplyExpandTrigger,
  WorkerReplyStaticBody,
  WORKER_REPLY_PREVIEW_FADE,
  fitsWorkerReplyPreview,
  workerReplyTextOf,
} from "./worker-reply-body";
import { cn } from "../lib/utils";
import { Collapsible } from "./ui/collapsible";

/**
 * The names and avatars the lines show: a teammate's own, and the worker
 * coding tasks run on as a coding task under a gear, since its results are
 * the task's, not a teammate's.
 */
export function linesNames(nameOf: (id: string) => string, lookOf: (id: string) => Look, isCoding: (id: string) => boolean): Pick<LineContextValue, "nameOf" | "avatarOf"> {
  return {
    nameOf: (id) => (isCoding(id) ? "Coding task" : nameOf(id)),
    avatarOf: (id): ReactNode =>
      isCoding(id) ? (
        <span aria-hidden className="shrink-0 text-muted-foreground">
          ⚙
        </span>
      ) : (
        <Avatar look={lookOf(id)} size="sm" />
      ),
  };
}

/** A message's words: its text parts, joined. */
export const textOf = (item: MessageItem): string => item.content.map((part) => ("text" in part && typeof part.text === "string" ? part.text : "")).join("");

/** The files a message carries: its `file` parts, references to the stored bytes. */
export const filesOf = (item: MessageItem): FileContent[] => item.content.filter((part): part is FileContent => part.type === "file");

/** A line's clock time, "3:56 PM", in the reader's locale; nothing for a line with no time. */
function clockTime(ts: number | undefined): string | undefined {
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return undefined;
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** What you said, and what the worker said. */
function MessageLine({ item, line }: { item: MessageItem; line?: ItemLine }) {
  const { readFile } = useLineContext();
  if (line?.kind === "user") {
    const files = filesOf(item);
    const text = textOf(item);
    const at = clockTime(item.ts);
    return (
      <div className="flex flex-col items-end gap-1.5">
        {files.length > 0 ? <MessageFiles files={files} readFile={readFile} /> : null}
        {/* A line of files alone has no words to box. */}
        {text !== "" || files.length === 0 ? (
          <div className="max-w-[min(560px,85%)] rounded-[14px_14px_4px_14px] border border-(--mine-line) bg-(--mine) px-4 py-2.5 text-base leading-[1.6] whitespace-pre-wrap text-foreground" data-entry="user">
            {text}
          </div>
        ) : null}
        {at === undefined ? null : (
          <time dateTime={new Date(item.ts).toISOString()} className="px-1 font-mono text-xs text-text-3" data-part="time">
            {at}
          </time>
        )}
      </div>
    );
  }
  const incomplete = line?.kind === "assistant" && line.incomplete === true;
  return (
    <div className="py-1 text-base leading-[1.65]" data-entry="assistant" data-incomplete={incomplete ? "true" : undefined}>
      <MarkdownText text={textOf(item)} />
      {incomplete ? <span className="mt-1 block text-xs text-text-3">Incomplete</span> : null}
    </div>
  );
}

/**
 * A message another teammate sent this one (`workforce:received`), as the
 * lab's report card: a header strip with the sender, what kind of message it
 * is and when, that folds the body away; then the message. The registry's
 * received line is the dashed one-box look; the lab draws its own.
 */
function ReportLine({ item }: { item: DataItem }) {
  const { nameOf = (id: string) => id, avatarOf } = useLineContext();
  const value = item.value as Partial<ReceivedMessageValue>;
  const from = value.from ?? "";
  const text = workerReplyTextOf(value.text);
  const notes = [value.noAnswer ? "no answer" : value.inReplyTo !== undefined ? "reply" : null, value.replyRequested ? "asks for a reply" : null].filter((n) => n !== null);
  const at = clockTime(item.ts);
  const collapsed = !fitsWorkerReplyPreview(text);
  const [open, setOpen] = useState(false);
  const sender = nameOf(from);
  const sectionProps = {
    "aria-label": `From ${nameOf(from)}`,
    "data-line": "received",
    "data-from": from,
    "data-message-id": value.id ?? "",
    "data-reply-requested": String(value.replyRequested === true),
    "data-collapsed-default": String(collapsed),
    className: "group/report relative w-full overflow-hidden rounded-lg border border-border bg-card shadow-(--shadow-card)",
  };

  const header = (
    <div
      className={cn(
        "flex items-center gap-2 px-4 py-2.5 text-sm",
        collapsed ? "border-b border-border group-data-[state=closed]/report:border-b-0" : "border-b border-border",
      )}
      data-part="label"
    >
      {avatarOf?.(from) ?? null}
      <span className="font-semibold text-foreground">{nameOf(from)}</span>
      {notes.length === 0 ? null : <span className="truncate rounded-full bg-muted px-2 py-px text-xs text-text-2">{notes.join(" · ")}</span>}
      <span className="flex-1" />
      {at === undefined ? null : (
        <time dateTime={new Date(item.ts).toISOString()} className="shrink-0 font-mono text-xs text-text-3">
          {at}
        </time>
      )}
      {collapsed ? (
        <WorkerReplyExpandTrigger
          open={open}
          expandLabel={`Show full message from ${sender}`}
          collapseLabel={`Collapse message from ${sender}`}
          group="report"
        />
      ) : null}
    </div>
  );

  if (!collapsed) {
    return (
      <section {...sectionProps}>
        {header}
        <WorkerReplyStaticBody text={text} />
      </section>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} defaultOpen={false} asChild>
      <section {...sectionProps}>
        {header}
        <WorkerReplyCollapsibleBody text={text} open={open} fadeFromClass={WORKER_REPLY_PREVIEW_FADE.received} />
      </section>
    </Collapsible>
  );
}

/**
 * A filed task's ending (`workforce:result`), as the lab's card: the worker's
 * name and how it ended in the header, its text collapsed when long.
 */
function ResultReportLine({ item }: { item: DataItem }) {
  const { nameOf = (id: string) => id, avatarOf, openTask } = useLineContext();
  const value = item.value as Partial<TaskResultValue>;
  const from = value.from ?? "";
  const failed = value.ending === "errored";
  const cancelled = value.ending === "cancelled";
  const said = `${from === "" ? "The task" : nameOf(from)} ${failed ? "couldn't finish" : cancelled ? "was cancelled" : "finished"}: ${value.title ?? ""}`;
  const taskId = value.taskId;
  const text = workerReplyTextOf(value.text);
  const at = clockTime(item.ts);
  const collapsed = !fitsWorkerReplyPreview(text);
  const opens = taskId !== undefined && openTask !== undefined ? () => openTask(taskId) : undefined;
  const [open, setOpen] = useState(false);
  const workerName = from === "" ? "task" : nameOf(from);

  const header = (
    <div className={cn("flex items-center gap-2 px-4 py-2.5 text-sm", collapsed ? "border-b border-border group-data-[state=closed]/result:border-b-0" : "border-b border-border")} data-part="label">
      {from === "" ? null : avatarOf?.(from) ?? null}
      {opens === undefined ? (
        <span className={cn("min-w-0 truncate font-semibold", failed && "text-destructive")}>{said}</span>
      ) : (
        <button type="button" aria-label={said} onClick={opens} className={cn("min-w-0 truncate text-left font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring", failed && "text-destructive")}>
          {said}
        </button>
      )}
      <span className="flex-1" />
      {at === undefined ? null : (
        <time dateTime={new Date(item.ts).toISOString()} className="shrink-0 font-mono text-xs text-text-3">
          {at}
        </time>
      )}
      {collapsed ? (
        <WorkerReplyExpandTrigger
          open={open}
          expandLabel={`Show full result from ${workerName}`}
          collapseLabel={`Collapse result from ${workerName}`}
          group="result"
        />
      ) : null}
    </div>
  );

  const sectionProps = {
    "aria-label": `Task result from ${workerName}`,
    "data-line": "result",
    "data-task-id": taskId ?? "",
    "data-status": failed ? "failed" : cancelled ? "cancelled" : "done",
    "data-collapsed-default": String(collapsed),
    className: "group/result relative w-full overflow-hidden rounded-lg border border-dashed border-success/60 bg-success/5 shadow-(--shadow-card)",
  };

  if (!collapsed) {
    return (
      <section {...sectionProps}>
        {header}
        {text === "" ? null : <WorkerReplyStaticBody text={text} />}
      </section>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} defaultOpen={false} asChild>
      <section {...sectionProps}>
        {header}
        {text === "" ? null : <WorkerReplyCollapsibleBody text={text} open={open} fadeFromClass={WORKER_REPLY_PREVIEW_FADE.result} />}
      </section>
    </Collapsible>
  );
}

/**
 * Whether the lab's look draws `line`: a stretch of thinking with no tool call
 * draws nothing (the compact steps show calls only), nor does a wait that
 * isn't your yes (the approval line draws only those; the task popup shows
 * the rest), nor an item {@link teammatesRenderers} turns off (a status, a
 * source, a trace). What reads what is on screen reads this: the unread
 * count, the answering line, the empty conversation.
 */
export function drawsLine(line: ItemLine): boolean {
  if (line.kind === "steps") return line.items.some((item) => item.type === "tool_output");
  if (line.kind === "suspension") return suspendForUserKindOf(line.item) === "approval";
  if (line.kind === "item") return (teammatesRenderers as Record<string, unknown>)[line.item.type] !== false;
  return true;
}

/** No board tasks read yet: one array, so a memoized card doesn't redraw for a new empty one. */
const NO_TASKS: readonly CodingBoardTask[] = [];
/** No roster read yet. */
const NO_WORKERS: readonly RosterEntry[] = [];

/**
 * The card a filed task shows until the board's task arrives: a pending task with what the filing said.
 * One object per item and harness, so the memoized card skips re-renders and takes the harness once the roster is read.
 */
const placeholders = new WeakMap<DataItem, CodingBoardTask>();
function placeholderOf(item: DataItem, value: Partial<FiledTaskValue>, harness: string | undefined): CodingBoardTask {
  let task = placeholders.get(item);
  if (task === undefined || task.harness !== (harness ?? null)) {
    const title = value.title ?? "";
    // Pending with nothing open: the view says `queued` for such a row.
    task = { id: value.taskId ?? "", goal: title, title, assignee: value.assignee ?? "", status: "pending", state: "queued", attempts: 0, asks: [], harness: harness ?? null, review: null, landed: null, error: null, pullRequests: [], runFlow: null, detail: null };
    placeholders.set(item, task);
  }
  return task;
}

/**
 * A task the worker filed, as the lab's live card: from the filing until the
 * board's task arrives, then from that task, in the same place. The board's
 * tasks are the conversation's (the session its `FlowProvider` names), and
 * whether the task is a coding task, and on which harness, is the roster's.
 */
function TaskLine({ item }: { item: DataItem }) {
  const { nameOf = (id: string) => id, avatarOf, openTask } = useLineContext();
  const { sessionId } = useFlowContext();
  const stale = useStale(sessionId);
  const { client, pollIntervalMs } = useAppClient();
  // `useTasks`' read, made here: the same view and input, so one watch serves both.
  const tasks = useView(codingBoardViewRef(), { sessionId: sessionId ?? "" }, { client, pollIntervalMs, enabled: sessionId !== undefined }).value ?? NO_TASKS;
  const roster = useView(rosterView, {}, { client, pollIntervalMs }).value ?? NO_WORKERS;
  const value = item.value as Partial<FiledTaskValue>;
  const coderOf = (id: string) => roster.find((w) => w.id === id && takesTasks(w));
  const filedFor = coderOf(value.assignee ?? "");
  const harness = filedFor === undefined ? undefined : settingOf(filedFor, "harness");
  const task = tasks.find((t) => t.id === value.taskId) ?? placeholderOf(item, value, harness);
  const worker = workerOf(task);
  return <TaskCard task={task} nameOf={nameOf} avatar={avatarOf?.(worker)} coding={coderOf(worker) !== undefined} stale={stale} onOpen={openTask ?? (() => undefined)} />;
}

/**
 * The registry's approval line, over a stop read by its kind: one a store kept
 * under the reason's old name reaches it as the approval it is. The line is a
 * registry copy that compares the reason itself, so the lab hands it the
 * current one rather than edit the copy.
 */
function CurrentApprovalLine({ item, line }: { item: SuspensionItem; line?: ItemLine }) {
  const approval = suspendForUserKindOf(item) === "approval";
  return <ApprovalLine item={approval && item.reason !== "user_approval" ? { ...item, reason: "user_approval" } : item} {...(line === undefined ? {} : { line })} />;
}

/**
 * The lab's registry: the registry's failed, stopped and approval lines and
 * workforce's lines, the lab's bubbles for messages (a task's brief folded),
 * and its own live card for a filed task. Module level, so the registry is
 * one object. A status, source or trace item draws nothing in the lab.
 */
export const teammatesRenderers: RendererRegistry = {
  ...conversationLineRenderers,
  suspension: CurrentApprovalLine,
  message: withBrief(MessageLine),
  status: false,
  source: false,
  block_trace: false,
  data: { ...workforceLineRenderers, [FILED_TASK_DATA_TYPE]: TaskLine, [RECEIVED_MESSAGE_DATA_TYPE]: ReportLine, [TASK_RESULT_DATA_TYPE]: ResultReportLine },
};

/**
 * One line, drawn through the registry the nearest `FlowProvider` holds
 * (the lab's, {@link teammatesRenderers}), its steps compact. Memoized: a
 * streamed chunk redraws only the line that changed.
 */
export const Line = memo(function Line({ line }: { line: ItemLine }): ReactNode {
  return <ItemsRenderer lines={[line]} toolGroupRenderer={CompactSteps} />;
});

/** {@link linesNames}, kept one object while its inputs don't change. */
export function useLinesNames(nameOf: (id: string) => string, lookOf: (id: string) => Look, isCoding: (id: string) => boolean) {
  return useMemo(() => linesNames(nameOf, lookOf, isCoding), [nameOf, lookOf, isCoding]);
}

