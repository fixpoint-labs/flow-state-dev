import type { SentLineMark } from "@flow-state-dev/react";
import { useState } from "react";
import { defaultRehypePlugins } from "streamdown";
import type { LabTask, TaskStatus, ThreadEntry } from "../adapter";
import { TASK_STATUS } from "../lib/task-status";
import type { ToolRun, ToolStep } from "../lib/tool-steps";
import { cn } from "../lib/utils";
import { Clamp } from "./Clamp";
import { MessageResponse } from "./flow-state/message";
import { RequestRecovery } from "./flow-state/request-recovery";
import { composeToolCallsLabel, toolRunOpen, type ToolStepStatus } from "./flow-state/tool-grouping";

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
        // Reading text: a 1.5 line, 8px between blocks, and list items and headings close to what they belong to. Streamdown's own gaps are for short chat bubbles and run long here.
        "text-sm leading-normal space-y-2 [&_li]:py-0.5 [&_:is(h1,h2,h3,h4,h5,h6)]:mt-4 [&_:is(h1,h2,h3,h4,h5,h6)]:mb-1",
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

/**
 * One entry of a thread. Your lines sit in a box on the right; the main
 * session's text is Markdown; a run of tool calls is one line in plain words
 * that opens to a line per call (`ToolRunLine`); a task's brief is one folded line (`BriefLine`), never your
 * line; a background result is one collapsed line at the point the main
 * session took it, which opens to the task's reply; a thread in threads mode is
 * a card (`ThreadCard`, which the main thread draws). A failed turn is the
 * registry's `request-recovery` line, with its reason; `onRetry` draws its
 * Retry, so pass it only for the newest turn while nothing runs. A reply its
 * turn never finished is marked incomplete. `mark` is the feed's
 * mark for your line (`useJumpToLatest`'s `mine`), so a line you send rises to
 * near the top of the feed.
 *
 * `tasks` is what the main thread hands a line that names a task (a result,
 * or the step that started it): the session's task rows, so its dot is the
 * task now, and the open the pane makes, behind its *Open task*. A task's own
 * sheet hands none: its lines name tasks on another board (FIX-2399 E4).
 *
 * A turn you stopped is the registry's `request-recovery` stopped line;
 * `stillRunning` is the background work it counts, which the thread passes
 * only to the line that can say it truly, and `onViewTasks` opens where those
 * tasks are listed.
 */
export function Entry({
  entry,
  mark,
  tasks,
  onRetry,
  stillRunning,
  onViewTasks,
}: {
  entry: ThreadEntry;
  mark?: SentLineMark;
  tasks?: FeedTasks;
  onRetry?: () => Promise<void>;
  stillRunning?: number;
  onViewTasks?: () => void;
}) {
  switch (entry.kind) {
    case "user":
      return (
        <div className="flex flex-col items-end gap-1.5" {...mark}>
          <div className="max-w-[80%] rounded-xl border border-border/40 bg-accent/50 px-4 py-3 text-sm" data-entry="user">
            {/* A task's first line is its brief, which can run to paragraphs: held to a few lines. */}
            <Clamp lines={6}>{entry.text}</Clamp>
          </div>
          {entry.sentToThread ? <span className="text-xs text-muted-foreground">↳ Sent to a task</span> : null}
        </div>
      );
    case "assistant":
      return (
        <div data-entry="assistant" data-incomplete={entry.incomplete ? "true" : undefined}>
          <AgentMarkdown text={entry.text} />
          {entry.incomplete ? <span className="mt-1 block text-xs text-muted-foreground">Incomplete</span> : null}
        </div>
      );
    case "brief":
      return <BriefLine text={entry.text} />;
    case "tool":
      return <ToolRunLine run={entry} tasks={tasks} />;
    case "result":
      return <ResultLine entry={entry} tasks={tasks} />;
    case "thread":
      // The main thread draws a thread card from its task row; elsewhere it is the call it was.
      return (
        <div className="font-mono text-xs text-muted-foreground" data-entry="tool">
          ▸ {composeToolCallsLabel([{ name: "createTask" }])}
        </div>
      );
    case "stopped":
      return (
        <div data-entry="stopped">
          <RequestRecovery stopped stillRunning={stillRunning} onView={onViewTasks} />
        </div>
      );
    case "failed":
      return (
        <div data-entry="failed">
          <RequestRecovery who="The main session" reason={entry.reason} code={entry.code} details={entry.details} onRetry={onRetry} />
        </div>
      );
  }
}

/** The session's task rows (`undefined` until read) and how to open one, as the main thread hands them to its lines. */
export interface FeedTasks {
  rows: readonly LabTask[] | undefined;
  open: (taskId: string) => void;
}

/**
 * What a result line shows of its task (FIX-2399 D2), the one place that
 * says so: the dot is the task now, the board's row; the words keep what the
 * line reported, with "now <status>" added once the task has moved on. A task
 * the board doesn't list keeps what the line reported. (A start line reports
 * no status, so its dot is the row's.)
 */
function lineStatus(reported: TaskStatus, row: LabTask | undefined): { dot: TaskStatus; now: TaskStatus | undefined } {
  const dot = row?.status ?? reported;
  return { dot, now: row !== undefined && row.status !== reported ? row.status : undefined };
}

/** A status dot, labelled with its status as the pane's done row's is, pulsing while the task runs. */
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
function OpenTask({ taskId, tasks }: { taskId: string; tasks: FeedTasks }) {
  return (
    <button type="button" onClick={() => tasks.open(taskId)} className="shrink-0 px-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
      Open task
    </button>
  );
}

/** The task a line names, when the board lists it and the line may open it. */
const rowOf = (tasks: FeedTasks | undefined, taskId: string | undefined) =>
  tasks === undefined || taskId === undefined ? undefined : tasks.rows?.find((row) => row.id === taskId);

/** One step's words, and for the step that started a task the board lists, its live dot and *Open task*. */
function StepLine({ step, tasks }: { step: ToolStep; tasks: FeedTasks | undefined }) {
  const row = rowOf(tasks, step.taskId);
  if (row === undefined || tasks === undefined) return <>{step.line}</>;
  return (
    <span className="inline-flex max-w-full items-center gap-2 align-bottom" data-task-id={row.id}>
      <StatusDot status={row.status} />
      <span className="min-w-0 truncate">{step.line}</span>
      <span className="shrink-0">
        <OpenTask taskId={row.id} tasks={tasks} />
      </span>
    </span>
  );
}

/** A failed step reads "(failed)" in words, and in the lab's red. */
const stepTone = (state: ToolStepStatus) => (state === "error" ? "text-destructive" : "text-muted-foreground");

/**
 * A run of tool calls: one line, which opens to a line per call. The run
 * shows open while it is running and folds once it isn't, unless you open
 * or close it yourself. The line never wraps: a long run's label is cut at
 * the edge, and each call is whole once the run opens.
 */
function ToolRunLine({ run, tasks }: { run: ToolRun; tasks: FeedTasks | undefined }) {
  const [chosen, setChosen] = useState<boolean>();
  if (run.steps.length === 1) {
    return (
      <div className={cn("truncate font-mono text-[11px] leading-5", stepTone(run.state))} data-entry="tool" data-state={run.state} title={run.label}>
        ▸ <StepLine step={{ ...run.steps[0]!, line: run.label }} tasks={tasks} />
      </div>
    );
  }
  const open = chosen ?? toolRunOpen(run.state);
  return (
    <div className="font-mono text-[11px] leading-5" data-entry="tool" data-state={run.state}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setChosen(!open)}
        title={run.label}
        className={cn("block w-full truncate text-left transition-colors hover:text-foreground", stepTone(run.state))}
      >
        {open ? "▾" : "▸"} {run.label}
      </button>
      {open ? (
        <ul className="mt-1 ml-1 flex flex-col gap-0.5 border-l border-border pl-3">
          {run.steps.map((step) => (
            <li key={step.id} className={cn("truncate", stepTone(step.state))} data-step-state={step.state} title={step.line}>
              <StepLine step={step} tasks={tasks} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * What a task's session was handed, as filed or re-queued: one folded line,
 * which opens to the brief's text. It is not your line, so it never sits in
 * your box.
 */
function BriefLine({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="font-mono text-xs text-muted-foreground" data-entry="brief">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-left hover:text-foreground">
        {open ? "▾" : "▸"} Task brief
      </button>
      {open ? <div className="mt-1 ml-3 font-sans whitespace-pre-wrap">{text}</div> : null}
    </div>
  );
}

/**
 * A background task's ending: one line with its title and status. The task's
 * reply is in its own view already, so here it stays folded until you open
 * the line. A task the board lists gets *Open task* beside the fold, and its
 * dot is the task now (`lineStatus`).
 */
function ResultLine({ entry, tasks }: { entry: Extract<ThreadEntry, { kind: "result" }>; tasks: FeedTasks | undefined }) {
  const [open, setOpen] = useState(false);
  const row = rowOf(tasks, entry.taskId);
  const shown = lineStatus(entry.status, row);
  const status = TASK_STATUS[entry.status];
  return (
    <section
      aria-label={`Background result: ${entry.title}`}
      data-entry="result"
      data-task-id={entry.taskId}
      data-during-turn={entry.duringTurn ? "true" : "false"}
      className="min-w-0 [overflow-wrap:anywhere]"
    >
      <div className={cn("flex min-w-0 items-center border border-border bg-card", open ? "rounded-t-md" : "rounded-md")}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          title={entry.duringTurn ? "Arrived while this turn was running" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
        >
          <span aria-hidden className="shrink-0 text-muted-foreground">
            {open ? "▾" : "▸"}
          </span>
          <StatusDot status={shown.dot} />
          <span className="min-w-0 truncate">{entry.title}</span>
          <span className={cn("shrink-0", status.tone)}>
            · {status.label}
            {shown.now === undefined ? "" : ` · now ${TASK_STATUS[shown.now].label}`}
          </span>
        </button>
        {row !== undefined && tasks !== undefined ? <OpenTask taskId={row.id} tasks={tasks} /> : null}
      </div>
      {open ? <AgentMarkdown text={entry.summary} className="rounded-b-md border-x border-b border-border px-3 py-2" /> : null}
    </section>
  );
}
