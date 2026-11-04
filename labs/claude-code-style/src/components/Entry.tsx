import type { SentLineMark } from "@flow-state-dev/react";
import { useState } from "react";
import { defaultRehypePlugins } from "streamdown";
import type { ThreadEntry } from "../adapter";
import { TASK_STATUS } from "../lib/task-status";
import type { ToolRun } from "../lib/tool-steps";
import { cn } from "../lib/utils";
import { MessageResponse } from "./flow-state/message";
import { RequestRecovery } from "./flow-state/request-recovery";
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
 * near the top of the feed. A turn you stopped is the registry's
 * `request-recovery` stopped line; `stillRunning` is the background work it
 * counts, which the thread passes only to the line that can say it truly, and
 * `onViewTasks` opens where those tasks are listed.
 */
export function Entry({
  entry,
  mark,
  stillRunning,
  onViewTasks,
}: {
  entry: ThreadEntry;
  mark?: SentLineMark;
  stillRunning?: number;
  onViewTasks?: () => void;
}) {
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
      return <ToolRunLine run={entry} />;
    case "result":
      return <ResultLine entry={entry} />;
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
  }
}

/** A failed step reads "(failed)" in words, and in the lab's red. */
const stepTone = (state: ToolStepState) => (state === "error" ? "text-destructive" : "text-muted-foreground");

/**
 * A run of tool calls: one line, which opens to a line per call. The run
 * shows open while it is running and folds once it isn't, unless you open
 * or close it yourself.
 */
function ToolRunLine({ run }: { run: ToolRun }) {
  const [chosen, setChosen] = useState<boolean>();
  if (run.steps.length === 1) {
    return (
      <div className={cn("font-mono text-xs", stepTone(run.state))} data-entry="tool" data-state={run.state}>
        ▸ {run.label}
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
              {step.line}
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
 * the line.
 */
function ResultLine({ entry }: { entry: Extract<ThreadEntry, { kind: "result" }> }) {
  const [open, setOpen] = useState(false);
  const status = TASK_STATUS[entry.status];
  return (
    <section
      aria-label={`Background result: ${entry.title}`}
      data-entry="result"
      data-task-id={entry.taskId}
      data-during-turn={entry.duringTurn ? "true" : "false"}
      className="min-w-0 [overflow-wrap:anywhere]"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={entry.duringTurn ? "Arrived while this turn was running" : undefined}
        className="flex w-full min-w-0 items-center gap-2 border border-border bg-card px-3 py-1.5 text-left text-xs hover:bg-accent"
      >
        <span aria-hidden className="shrink-0 text-muted-foreground">
          {open ? "▾" : "▸"}
        </span>
        <span className={cn("size-1.5 shrink-0 rounded-full", status.dot)} />
        <span className="min-w-0 truncate">{entry.title}</span>
        <span className={cn("shrink-0", status.tone)}>· {status.label}</span>
      </button>
      {open ? <AgentMarkdown text={entry.summary} className="border-x border-b border-border px-3 py-2" /> : null}
    </section>
  );
}
