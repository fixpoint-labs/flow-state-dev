import type { SentLineMark } from "@flow-state-dev/react";
import { useState } from "react";
import { defaultRehypePlugins } from "streamdown";
import type { ThreadEntry } from "../adapter";
import { TASK_STATUS } from "../lib/task-status";
import type { ToolRun } from "../lib/tool-steps";
import { cn } from "../lib/utils";
import { Clamp } from "./Clamp";
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
 * that opens to a line per call (`ToolRunLine`); a background result is one collapsed line at the point the main
 * session took it, which opens to the task's reply; a thread in threads mode is
 * a card (`ThreadCard`, which the main thread draws). A failed turn is the
 * registry's `request-recovery` line, with its reason; `onRetry` draws its
 * Retry, so pass it only for the newest turn while nothing runs. A reply its
 * turn never finished is marked incomplete. `mark` is the feed's
 * mark for your line (`useJumpToLatest`'s `mine`), so a line you send rises to
 * near the top of the feed.
 */
export function Entry({ entry, mark, onRetry }: { entry: ThreadEntry; mark?: SentLineMark; onRetry?: () => Promise<void> }) {
  switch (entry.kind) {
    case "user":
      return (
        <div className="flex flex-col items-end gap-1.5" {...mark}>
          <div className="max-w-[80%] rounded-xl border border-border/40 bg-accent/50 px-4 py-3 text-sm" data-entry="user">
            {/* A task's first line is its brief, which can run to paragraphs: held to a few lines. */}
            <Clamp lines={6}>{entry.text}</Clamp>
            {entry.queued ? <span className="mt-1 block text-xs text-muted-foreground">queued · runs when this turn ends</span> : null}
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
    case "interrupted":
      return (
        <div className="text-xs text-muted-foreground" data-entry="interrupted">
          Interrupted. Background tasks keep running.
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

/** A failed step reads "(failed)" in words, and in the lab's red. */
const stepTone = (state: ToolStepState) => (state === "error" ? "text-destructive" : "text-muted-foreground");

/**
 * A run of tool calls: one line, which opens to a line per call. The run
 * shows open while it is running and folds once it isn't, unless you open
 * or close it yourself. The line never wraps: a long run's label is cut at
 * the edge, and each call is whole once the run opens.
 */
function ToolRunLine({ run }: { run: ToolRun }) {
  const [chosen, setChosen] = useState<boolean>();
  if (run.steps.length === 1) {
    return (
      <div className={cn("truncate font-mono text-[11px] leading-5", stepTone(run.state))} data-entry="tool" data-state={run.state} title={run.label}>
        ▸ {run.label}
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
        className={cn("flex w-full min-w-0 items-center gap-2 border border-border bg-card px-3 py-1.5 text-left text-xs hover:bg-accent", open ? "rounded-t-md" : "rounded-md")}
      >
        <span aria-hidden className="shrink-0 text-muted-foreground">
          {open ? "▾" : "▸"}
        </span>
        <span className={cn("size-1.5 shrink-0 rounded-full", status.dot)} />
        <span className="min-w-0 truncate">{entry.title}</span>
        <span className={cn("shrink-0", status.tone)}>· {status.label}</span>
      </button>
      {open ? <AgentMarkdown text={entry.summary} className="rounded-b-md border-x border-b border-border px-3 py-2" /> : null}
    </section>
  );
}
