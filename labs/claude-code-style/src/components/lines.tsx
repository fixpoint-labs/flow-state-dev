/**
 * How the lab draws a thread's lines: React's conversation model
 * (`conversationLines`) decides what each line is, and the UI registry's
 * `conversation-lines` and `workforce-lines` copies draw it, configured by
 * the screen's line context. A run of tool calls is the registry's compact
 * steps line; a turn that failed or was stopped is the registry's line, and a
 * task's brief folds to one line.
 *
 * What is the lab's own: your lines sit in a box on the right and the main
 * session's text is Markdown; a task the main session started is one line
 * with the task's dot as it is now and *Open task*; a task's ending is one
 * collapsed line with its title and status, which opens to what it came back
 * with. The dot and *Open task* show only where the screen opens tasks
 * (`openTask`): a task's own sheet names tasks on another board. Threads
 * mode's thread cards are the main thread's (`Thread`).
 */
import { memo, useMemo, useState, type ReactNode } from "react";
import { defaultRehypePlugins } from "streamdown";
import type { DataItem, FileContent, MessageItem, OutputItem } from "@flow-state-dev/core/items";
import { conversationLines, FlowProvider, ItemsRenderer, useFlowContext, type ItemLine, type LineTurn, type RendererRegistry, type SentLineMark } from "@flow-state-dev/react";
import { FILED_TASK_DATA_TYPE, TASK_RESULT_DATA_TYPE, type FiledTaskValue, type TaskResultValue } from "@flow-state-dev/workforce/browser";
// The read itself and not the app's index: the app's index reads nothing of the lines.
import { useTasks, type AppTask, type TaskStatus } from "../app/tasks";
import { TASK_STATUS } from "../lib/task-status";
import { cn } from "../lib/utils";
import { Clamp } from "./Clamp";
import { CompactSteps, conversationLineRenderers, useLineContext } from "./flow-state/conversation-lines";
import { MessageFiles, MessageResponse } from "./flow-state/message";
import { useSessionItems } from "./flow-state/session-items-context";
import { toolSubject } from "./flow-state/tool-naming";
import { isTaskBrief, withBrief, workforceLineRenderers } from "./flow-state/workforce-lines";

/**
 * Streamdown's own pipeline without `raw`: agent text is Markdown, and any
 * HTML in it shows as the text it is rather than being built into elements.
 */
const NO_RAW_HTML = [defaultRehypePlugins.sanitize!, defaultRehypePlugins.harden!];

/** An agent's Markdown, drawn as it streams: an unfinished fence or list renders as far as it goes. */
function AgentMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <MessageResponse
      className={cn(
        // Reading text at the body step, 8px between blocks, and list items and headings close to what they belong to. Streamdown's own gaps are for short chat bubbles and run long here.
        "text-base space-y-2 [&_li]:py-0.5 [&_:is(h1,h2,h3,h4,h5,h6)]:mt-4 [&_:is(h1,h2,h3,h4,h5,h6)]:mb-1",
        // Text stays in the column: a long path, link or token breaks where it must, and code wraps instead of scrolling sideways.
        "min-w-0 [overflow-wrap:anywhere] [&_code]:[overflow-wrap:anywhere] [&_code]:whitespace-pre-wrap [&_pre]:whitespace-pre-wrap",
        className,
      )}
      rehypePlugins={NO_RAW_HTML}
    >
      {text}
    </MessageResponse>
  );
}

/** A message's words: its text parts, joined. */
export const textOf = (item: MessageItem): string => item.content.map((part) => ("text" in part && typeof part.text === "string" ? part.text : "")).join("");

/** The files a message carries: its `file` parts, references to the stored bytes. */
const filesOf = (item: MessageItem): FileContent[] => item.content.filter((part): part is FileContent => part.type === "file");

/**
 * Your line in a box on the right, the files it carries above it (a thumbnail
 * per image, `readFile` reading its bytes); the main session's Markdown,
 * marked when its turn never finished it.
 */
function MessageLine({ item, line }: { item: MessageItem; line?: ItemLine }) {
  const { readFile } = useLineContext();
  const text = textOf(item);
  if (line?.kind === "user") {
    const files = filesOf(item);
    return (
      <div className="flex flex-col items-end gap-1.5">
        {files.length > 0 ? <MessageFiles files={files} readFile={readFile} /> : null}
        {/* A line of files alone has no words to box. */}
        {text !== "" || files.length === 0 ? (
          <div className="max-w-[80%] rounded-xl border border-border/40 bg-accent/50 px-4 py-3 text-base" data-entry="user">
            {/* A task's first line is its brief, which can run to paragraphs: held to a few lines. */}
            <Clamp lines={6}>{text}</Clamp>
          </div>
        ) : null}
      </div>
    );
  }
  const incomplete = line?.kind === "assistant" && line.incomplete === true;
  return (
    <div data-entry="assistant" data-incomplete={incomplete ? "true" : undefined}>
      <AgentMarkdown text={text} />
      {incomplete ? <span className="mt-1 block text-xs text-muted-foreground">Incomplete</span> : null}
    </div>
  );
}

/**
 * The task a line names, as the board has it now, where the screen opens
 * tasks: the conversation's board (the session its `FlowProvider` names), the
 * same read as the pane's. Elsewhere none, so the line shows what it reported.
 */
function useBoardTask(taskId: string | undefined): AppTask | undefined {
  const { openTask } = useLineContext();
  const { sessionId } = useFlowContext();
  const tasks = useTasks(openTask === undefined ? undefined : sessionId).value;
  return taskId === undefined ? undefined : tasks?.find((task) => task.id === taskId);
}

/** A status dot, labelled with its status as the pane labels a done task's, pulsing while the task runs. */
function StatusDot({ status, className }: { status: TaskStatus; className?: string }) {
  const shown = TASK_STATUS[status];
  return (
    <span
      data-task-dot
      aria-label={shown.label}
      className={cn("size-1.5 shrink-0 rounded-full", shown.dot, status === "in_progress" && "animate-pulse", className)}
    />
  );
}

/** *Open task*: opens the task in the pane's sheet, as a pick in the pane does. */
function OpenTask({ taskId }: { taskId: string }) {
  const { openTask } = useLineContext();
  return (
    <button type="button" onClick={() => openTask?.(taskId)} className="shrink-0 px-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
      Open task
    </button>
  );
}

/** A task the main session started (`workforce:task`): one line, with the task's dot as it is now and *Open task*. */
function StartLine({ item }: { item: DataItem }) {
  const value = item.value as Partial<FiledTaskValue>;
  const task = useBoardTask(value.taskId);
  const words = toolSubject("createTask", { title: value.title })?.text ?? "Start a task";
  return (
    <div className="truncate font-mono text-xs leading-5 text-muted-foreground" data-entry="task" title={words}>
      ▸{" "}
      {task === undefined ? (
        words
      ) : (
        <span className="inline-flex max-w-full items-center gap-2 align-bottom" data-task-id={task.id}>
          <StatusDot status={task.status} />
          <span className="min-w-0 truncate">{words}</span>
          <OpenTask taskId={task.id} />
        </span>
      )}
    </div>
  );
}

/**
 * A task's ending (`workforce:result`): one line with its title and status.
 * The task's reply is in its own view already, so here it stays folded until
 * you open the line. The words keep the ending the line reported; the dot is
 * the task now, as the board has it, with "now <status>" added once the task has
 * moved on. A task the board lists gets *Open task* beside the fold.
 */
function ResultLine({ item }: { item: DataItem }) {
  const [open, setOpen] = useState(false);
  const value = item.value as Partial<TaskResultValue>;
  const reported: TaskStatus = value.ending ?? "completed";
  const task = useBoardTask(value.taskId);
  const now = task !== undefined && task.status !== reported ? task.status : undefined;
  const status = TASK_STATUS[reported];
  // Taken while a turn of yours was running: your line is in the same request.
  const duringTurn = useSessionItems().some((other) => other.requestId === item.requestId && other.type === "message" && (other as MessageItem).role === "user" && !isTaskBrief(other));
  return (
    <section
      aria-label={`Background result: ${value.title ?? ""}`}
      data-entry="result"
      data-task-id={value.taskId ?? ""}
      data-during-turn={duringTurn ? "true" : "false"}
      className="min-w-0 [overflow-wrap:anywhere]"
    >
      <div className={cn("flex min-w-0 items-center border border-border bg-card", open ? "rounded-t-md" : "rounded-md")}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          title={duringTurn ? "Arrived while this turn was running" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
        >
          <span aria-hidden className="shrink-0 text-muted-foreground">
            {open ? "▾" : "▸"}
          </span>
          <StatusDot status={task?.status ?? reported} />
          <span className="min-w-0 truncate">{value.title}</span>
          <span className={cn("shrink-0", status.tone)}>
            · {status.label}
            {now === undefined ? "" : ` · now ${TASK_STATUS[now].label}`}
          </span>
        </button>
        {task === undefined ? null : <OpenTask taskId={task.id} />}
      </div>
      {open ? <AgentMarkdown text={value.text ?? ""} className="rounded-b-md border-x border-b border-border px-3 py-2" /> : null}
    </section>
  );
}

/**
 * The lab's registry: the registry's failed, stopped and approval lines and
 * workforce's lines, the lab's own message, start and ending lines, a task's
 * brief folded. Module level, so the registry is one object.
 */
export const claudeCodeRenderers: RendererRegistry = {
  ...conversationLineRenderers,
  message: withBrief(MessageLine),
  data: { ...workforceLineRenderers, [FILED_TASK_DATA_TYPE]: StartLine, [TASK_RESULT_DATA_TYPE]: ResultLine },
};

/** A session's items as the lab's lines, kept one array while its items and turns don't change. */
export function useLines(items: readonly OutputItem[] | undefined, turns: readonly LineTurn[] = NO_TURNS): ItemLine[] | undefined {
  return useMemo(() => (items === undefined ? undefined : conversationLines(items, turns, { renderers: claudeCodeRenderers })), [items, turns]);
}

/** No turns: a task's work offers no Retry and draws no stopped line. */
const NO_TURNS: readonly LineTurn[] = [];

/**
 * One line, drawn through the registry the nearest `FlowProvider` holds
 * (the lab's, {@link claudeCodeRenderers}), its steps compact. Memoized: a
 * streamed chunk redraws only the line that changed.
 */
export const Line = memo(function Line({ line }: { line: ItemLine }): ReactNode {
  return <ItemsRenderer lines={[line]} toolGroupRenderer={CompactSteps} />;
});

/**
 * A task's work: its run's lines, drawn with no action, since they name tasks
 * on another board. `mine` is the feed's mark for your lines, so a line you
 * send rises to near the top of the feed.
 */
export function WorkLines({ lines, mine }: { lines: readonly ItemLine[] | undefined; mine?: (id: string) => SentLineMark }) {
  return (
    <FlowProvider renderers={claudeCodeRenderers}>
      {lines?.map((line) =>
        line.kind === "user" && mine !== undefined ? (
          <div key={line.id} {...mine(line.id)}>
            <Line line={line} />
          </div>
        ) : (
          <Line key={line.id} line={line} />
        ),
      )}
    </FlowProvider>
  );
}
