import { useState } from "react";
import type { LabAdapter, BoardTask } from "../adapter";
import { useWatch } from "../lib/use-watch";

/**
 * A task a conversation filed: one line with what it is and how it stands,
 * opening to the run, read only. A coding task reads as a background task,
 * never as a task for a teammate.
 */
export function TaskCard({
  adapter,
  task,
  nameOf,
  coding = false,
  defaultOpen = false,
}: {
  adapter: LabAdapter;
  task: BoardTask;
  nameOf: (id: string) => string;
  /** It is a coding task: a background task, not a teammate's. */
  coding?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const steps = useWatch(adapter.watchRun, open ? task.runSessionId : undefined) ?? [];
  const to = nameOf(task.to);
  const label = coding ? `Coding task: ${task.title}` : `Task for ${to}: ${task.title}`;
  return (
    <div data-entry="task" data-status={task.status} className="max-w-[85%] rounded-md border border-dashed border-success/60">
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 px-3 py-1.5 text-left font-mono text-xs text-success hover:bg-success/5"
      >
        <span className="shrink-0">⚙ {coding ? "coding task" : `task for ${to}`} ·</span>
        <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
        <span className="shrink-0 text-muted-foreground" data-task-status>
          {task.status}
        </span>
        <span aria-hidden className="shrink-0 text-muted-foreground">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <ol aria-label={`Run of ${task.title}`} className="border-t border-dashed border-border px-3 py-2 font-mono text-xs text-muted-foreground">
          {steps.map((s) => (
            <li key={s.id}>· {s.text}</li>
          ))}
          {task.result ? <li className="text-foreground">{task.result}</li> : null}
        </ol>
      ) : null}
    </div>
  );
}
