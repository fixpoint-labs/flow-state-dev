import { memo, type ReactNode } from "react";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { attemptStartedAt, harnessOf, isActive, modelOf, taskStatus, workerOf } from "../lib/task";
import { taskPresentation } from "../lib/task-presentation";
import { cn } from "../lib/utils";
import { Spend } from "./flow-state/spend";

/** "Draft the PM role" as it reads after "Asked writer to". */
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** A task's line, the same in the conversation and on the popup: a coding task, or what was asked of whom. */
export function taskLine(task: { title: string; to: string }, coding: boolean, nameOf: (id: string) => string): string {
  return coding ? `Coding task: ${task.title}` : `Asked ${nameOf(task.to)} to ${lowerFirst(task.title)}`;
}

/** What a coding task runs on, as its line names it: the harness, and the model when its run reported one. */
export function runsOn(task: { harness?: string; model?: string }): string | undefined {
  if (task.harness === undefined) return undefined;
  return task.model === undefined ? task.harness : `${task.harness} · ${task.model}`;
}

/** A coding task line's accessible name: its line, and what it runs on. */
export const taskLabel = (line: string, task: { harness?: string; model?: string }) => {
  const on = runsOn(task);
  return on === undefined ? line : `${line}, on ${on}`;
};
/** How long an active task has run, coarse for its card: "42s", "2m", "3h", "2d". */
function sinceShort(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/** The terminal mark a coding task's tile carries. */
function TerminalIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

/**
 * A task a conversation filed, as a card in the thread: a tile (a terminal
 * for a coding task, the teammate's avatar for a teammate's), its title, what
 * it runs on and spent, how it stands, and *Open*, which opens the task's
 * run in a popup, where its buttons are. Memoized, like a conversation's entries.
 */
export const TaskCard = memo(function TaskCard({
  task,
  nameOf,
  avatar,
  coding = false,
  onOpen,
}: {
  /** The board's row, or a filed task's stand-in before its row is read. */
  task: CodingBoardTask;
  nameOf: (id: string) => string;
  /** The teammate's avatar, shown on a teammate's task. */
  avatar?: ReactNode;
  /** It is a coding task: a background task, not a teammate's. */
  coding?: boolean;
  onOpen: (taskId: string) => void;
}) {
  const line = taskLine({ title: task.title, to: workerOf(task) }, coding, nameOf);
  const runs = { harness: harnessOf(task), model: modelOf(task) };
  const on = coding ? runsOn(runs) : undefined;
  const state = taskPresentation(task);
  const status = taskStatus(task);
  const active = isActive(task);
  const started = attemptStartedAt(task);
  // Only an active task counts up; an idle one says what it waits on, an ended one how it ended.
  const since = active && typeof started === "number" ? sinceShort(Date.now() - started) : undefined;
  // A coding task leads with its title (the tile says it is code); a teammate's says what was asked of whom.
  const title = coding ? task.title : line;
  return (
    <div
      data-entry="task"
      data-status={status}
      className="relative flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm shadow-(--shadow-card) hover:border-border-strong"
    >
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-text-2">
        {coding ? <TerminalIcon /> : avatar}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium text-foreground">{title}</span>
        {/* What it runs on and spent, then where it landed: mono, like every other model, token and path in the app. */}
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-text-3">
          {on === undefined ? null : (
            <span className="truncate" data-harness>
              {on}
            </span>
          )}
          {/* What its runs spent: tokens, and the charge when the vendor reported one. The tag before names the model. */}
          {coding && task.spend ? (
            <>
              {on === undefined ? null : <span aria-hidden>·</span>}
              <Spend spend={{ ...task.spend, model: null }} className="w-auto shrink-0" />
            </>
          ) : null}
          {task.landed == null ? null : (
            <>
              {on === undefined && !(coding && task.spend) ? null : <span aria-hidden>·</span>}
              <span data-task-landed={task.landed.kind} className="shrink-0">
                {task.landed.kind === "pull-request" ? `PR #${task.landed.number}` : `merged into ${task.landed.branch}`}
              </span>
            </>
          )}
        </span>
      </span>
      <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", state.pill)} data-task-pill>
        <span className="inline-block first-letter:uppercase" data-task-status>
          {state.word}
        </span>
        {since === undefined ? null : (
          <span className="font-mono" data-task-since>
            · {since}
          </span>
        )}
      </span>
      <button
        type="button"
        aria-label={coding ? taskLabel(line, runs) : line}
        onClick={() => onOpen(task.id)}
        // One control: its ::after stretches over the card, so a click anywhere on the card is this button's, with one tab stop.
        className="shrink-0 rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-foreground after:absolute after:inset-0 after:rounded-lg after:content-[''] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      >
        Open
      </button>
    </div>
  );
});
