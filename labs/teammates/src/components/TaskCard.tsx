import { memo, type ReactNode } from "react";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { harnessOf, modelOf, taskStatus, titleOf, workerOf } from "../lib/task";
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
/** What a coding task runs on, as a small tag after its line. */
export function RunsOn({ on }: { on: string }) {
  return (
    <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-xs font-normal text-muted-foreground" data-harness>
      {on}
    </span>
  );
}

/**
 * A task a conversation filed, as one line in the thread: what was asked of
 * whom, or a coding task, and how it stands. It opens the task's run in a
 * popup, where its buttons are. Memoized, like a conversation's entries.
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
  const line = taskLine({ title: titleOf(task), to: workerOf(task) }, coding, nameOf);
  const runs = { harness: harnessOf(task), model: modelOf(task) };
  const on = coding ? runsOn(runs) : undefined;
  const state = taskPresentation(task);
  return (
    <button
      type="button"
      data-entry="task"
      data-status={taskStatus(task)}
      aria-label={coding ? taskLabel(line, runs) : line}
      onClick={() => onOpen(task.id)}
      className="flex w-full max-w-[85%] items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-1.5 text-left text-sm hover:bg-accent"
    >
      {coding ? (
        <span aria-hidden className="shrink-0 text-muted-foreground">
          ⚙
        </span>
      ) : (
        avatar
      )}
      <span className="min-w-0 flex-1 truncate">{line}</span>
      {on === undefined ? null : <RunsOn on={on} />}
      {task.landed == null ? null : (
        <span data-task-landed={task.landed.kind} className="shrink-0 text-xs text-muted-foreground">
          {task.landed.kind === "pull-request" ? `PR #${task.landed.number}` : `merged into ${task.landed.branch}`}
        </span>
      )}
      {/* What its runs spent: tokens, and the charge when the vendor reported one. The tag above names the model. */}
      {coding && task.spend ? <Spend spend={{ ...task.spend, model: null }} className="w-auto shrink-0" /> : null}
      <span className={cn("shrink-0 text-xs", state.tone)} data-task-status>
        {state.word}
      </span>
    </button>
  );
});
