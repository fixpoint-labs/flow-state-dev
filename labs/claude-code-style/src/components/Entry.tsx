import type { SentLineMark } from "@flow-state-dev/react";
import { useState } from "react";
import { defaultRehypePlugins } from "streamdown";
import type { TaskRow, TaskStatus, ThreadEntry } from "../adapter";
import { TASK_STATUS } from "../lib/task-status";
import type { ToolRun, ToolStep } from "../lib/tool-steps";
import { cn } from "../lib/utils";
import { MessageResponse } from "./flow-state/message";
import { composeToolCallsLabel, toolRunOpen, type ToolStepState } from "./flow-state/tool-grouping";

/**
 * Streamdown's own pipeline without `raw`: agent text is Markdown, and any
 * HTML in it shows as the text it is rather than being built into elements.
 */
const NO_RAW_HTML = [defaultRehypePlugins.sanitize!, defaultRehypePlugins.harden!];

/** An agent's Markdown, drawn as it streams: an unfinished fence or list renders as far as it goes. */
function AgentMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <MessageResponse className={cn("text-sm leading-relaxed", className)} rehypePlugins={NO_RAW_HTML}>
      {text}
    </MessageResponse>
  );
}

/**
 * One entry of a thread. Your lines sit in a box on the right; the main
 * session's text is Markdown; a run of tool calls is one line in plain words
 * that opens to a line per call (`ToolRunLine`); a background result is one collapsed line at the point the main
 * session took it, which opens to the task's reply; a thread in threads mode is
 * a card (`ThreadCard`, which the main thread draws). `mark` is the feed's
 * mark for your line (`useJumpToLatest`'s `mine`), so a line you send rises to
 * near the top of the feed.
 *
 * `tasks` is what the main thread hands a line that names a task (a result,
 * or the step that started it): the session's task rows, so its dot is the
 * task now, and the open the pane makes, behind its *Open task*. A task's own
 * sheet hands none: its lines name tasks on another board (FIX-2399 E4).
 */
export function Entry({ entry, mark, tasks }: { entry: ThreadEntry; mark?: SentLineMark; tasks?: FeedTasks }) {
  switch (entry.kind) {
    case "user":
      return (
        <div className="flex flex-col items-end gap-1" {...mark}>
          <div className="max-w-[80%] border border-border bg-card px-3 py-2 text-sm whitespace-pre-wrap" data-entry="user">
            {entry.text}
            {entry.queued ? <span className="mt-1 block text-xs text-muted-foreground">queued · runs when this turn ends</span> : null}
          </div>
          {entry.sentToThread ? <span className="text-xs text-muted-foreground">↳ Sent to a task</span> : null}
        </div>
      );
    case "assistant":
      return (
        <div data-entry="assistant">
          <AgentMarkdown text={entry.text} />
        </div>
      );
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
    case "interrupted":
      return (
        <div className="text-xs text-muted-foreground" data-entry="interrupted">
          Interrupted. Background tasks keep running.
        </div>
      );
  }
}

/** The session's task rows (`undefined` until read) and how to open one, as the main thread hands them to its lines. */
export interface FeedTasks {
  rows: readonly TaskRow[] | undefined;
  open: (taskId: string) => void;
}

/**
 * What a result line shows of its task (FIX-2399 D2), the one place that
 * says so: the dot is the task now, the board's row; the words keep what the
 * line reported, with "now <status>" added once the task has moved on. A task
 * the board doesn't list keeps what the line reported. (A start line reports
 * no status, so its dot is the row's.)
 */
function lineStatus(reported: TaskStatus, row: TaskRow | undefined): { dot: TaskStatus; now: TaskStatus | undefined } {
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
    <span className="inline-flex items-center gap-2" data-task-id={row.id}>
      <StatusDot status={row.status} />
      <span>{step.line}</span>
      <OpenTask taskId={row.id} tasks={tasks} />
    </span>
  );
}

/** A failed step reads "(failed)" in words, and in the lab's red. */
const stepTone = (state: ToolStepState) => (state === "error" ? "text-destructive" : "text-muted-foreground");

/**
 * A run of tool calls: one line, which opens to a line per call. The run
 * shows open while it is running and folds once it isn't, unless you open
 * or close it yourself.
 */
function ToolRunLine({ run, tasks }: { run: ToolRun; tasks: FeedTasks | undefined }) {
  const [chosen, setChosen] = useState<boolean>();
  if (run.steps.length === 1) {
    return (
      <div className={cn("font-mono text-xs", stepTone(run.state))} data-entry="tool" data-state={run.state}>
        ▸ <StepLine step={{ ...run.steps[0]!, line: run.label }} tasks={tasks} />
      </div>
    );
  }
  const open = chosen ?? toolRunOpen(run.state);
  return (
    <div className="font-mono text-xs" data-entry="tool" data-state={run.state}>
      <button type="button" aria-expanded={open} onClick={() => setChosen(!open)} className={cn("text-left hover:text-foreground", stepTone(run.state))}>
        {open ? "▾" : "▸"} {run.label}
      </button>
      {open ? (
        <ul className="mt-1 ml-3 flex flex-col gap-0.5">
          {run.steps.map((step) => (
            <li key={step.id} className={stepTone(step.state)} data-step-state={step.state}>
              <StepLine step={step} tasks={tasks} />
            </li>
          ))}
        </ul>
      ) : null}
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
      <div className="flex min-w-0 items-center border border-border bg-card">
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
      {open ? <AgentMarkdown text={entry.summary} className="border-x border-b border-border px-3 py-2" /> : null}
    </section>
  );
}
