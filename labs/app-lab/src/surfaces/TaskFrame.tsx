/**
 * The task level (S1, BR-1 to BR-4): the route `/tasks/:boardRef/:taskId/:tab`
 * inside FIX-1662's frame. A header from the row, the one working control
 * (Interrupt), the controls with no shipped operation disabled with their gap
 * line, and four tabs: Session (the run the row names, live), Diff and Checks
 * (named empty states), and Brief (the row as stored).
 *
 * What the screen reads is held by {@link TaskProvider}; this file only draws
 * it. The only write the screen makes is the abort behind Interrupt.
 */
import { useEffect, useState } from "react";
import { EmptyState, SectionFailure, Tabs } from "../components/ui";
import { columnFor, readStatus } from "../lib/columns";
import { waited } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { navigate, TASK_TABS, type TaskTab } from "../lib/routes";
import { channelOf, useTask } from "../lib/task";
import type { Gaps } from "../gaps";
import { TaskSession } from "./TaskSession";

export function TaskFrame({ tab, gaps }: { tab: TaskTab; gaps: Gaps }) {
  const task = useTask();
  const { snapshot } = useLab();
  const { row, boardRef, taskId } = task;

  if (row === undefined && !task.waiting && task.rowFailure === undefined) {
    return (
      <EmptyState title="No such task on this board" testId="task-missing">
        The board {boardRef} holds no task "{taskId}".
        {task.gaveUp ? (
          <button type="button" className="ml-1 underline" onClick={task.retryRow}>
            Retry
          </button>
        ) : null}
      </EmptyState>
    );
  }

  const seats = snapshot !== undefined && snapshot.refused === undefined && snapshot.inventory.ok ? snapshot.inventory.value.seats : [];
  const worker = row?.assignee == null ? null : (seats.find((s) => s.id === row.assignee || s.name === row.assignee)?.id ?? row.assignee);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="task-frame" data-board-ref={boardRef} data-task-id={taskId}>
      <header className="px-4 pt-3">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">
          TASK ·{" "}
          <button type="button" className="hover:underline" onClick={() => navigate({ level: "workstream", channelId: channelOf(boardRef), tab: "board" })}>
            {boardRef}
          </button>
        </p>
        <h1 className="text-base font-semibold" data-testid="task-title">
          {row?.title ?? taskId}
        </h1>
        <p className="text-xs text-muted-foreground" data-testid="task-status">
          {row === undefined ? "Not on this board yet." : `${row.status} · ${columnFor(row.status)}`}
          {worker === null ? "" : ` · ${worker}`}
          {row !== undefined && readStatus(row.status) === "in_progress" && row.startedAt !== null ? <Elapsed since={row.startedAt} /> : null}
          {row?.run == null ? "" : ` · attempt ${row.run.attempt}`}
        </p>
        {task.rowFailure === undefined ? null : (
          <div className="mt-2">
            <SectionFailure what="This task's board" failure={task.rowFailure} onRetry={task.retryRow} />
          </div>
        )}
        <Actions gaps={gaps} />
      </header>
      <Tabs label="Task" tabs={TASK_TABS} selected={tab} onSelect={(next) => navigate({ level: "task", boardRef, taskId, tab: next })} />
      <div role="tabpanel" data-tabpanel={tab} data-testid="task-slot" className="flex min-h-0 flex-1 flex-col">
        {tab === "session" ? (
          <TaskSession />
        ) : tab === "diff" ? (
          <EmptyState title={gaps.task.diff.title} testId="task-diff-empty">
            <span data-gap>{gaps.task.diff.body}</span>
          </EmptyState>
        ) : tab === "checks" ? (
          <EmptyState title={gaps.task.checks.title} testId="task-checks-empty">
            <span data-gap>{gaps.task.checks.body}</span>
          </EmptyState>
        ) : (
          <Brief gaps={gaps} />
        )}
      </div>
      <Composer gaps={gaps} />
    </div>
  );
}

/** Elapsed time from the row's start, by a clock rather than a read (BR-4). */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return <span data-testid="task-elapsed"> · running {waited(since, now)}</span>;
}

/** What the run's request record says, in the screen's words. */
function runWord(status: string | undefined): string {
  switch (status) {
    case undefined:
      return "";
    case "in_progress":
      return "running";
    case "aborted":
      return "interrupted";
    default:
      return status;
  }
}

/** Interrupt, and the controls with no shipped operation (D2). */
function Actions({ gaps }: { gaps: Gaps }) {
  const task = useTask();
  const running = task.run.kind === "open" && task.status === "in_progress";
  const pending = task.interrupt.kind === "pending";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 pb-2" data-testid="task-actions">
      <button
        type="button"
        disabled={!running || pending}
        onClick={() => void task.requestInterrupt()}
        data-testid="task-interrupt"
        className="rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50"
        title={running ? "Stop this run (Esc)" : "Nothing is running"}
      >
        {pending ? "Interrupting…" : "Interrupt"}
      </button>
      <span className="text-xs text-muted-foreground" data-testid="run-state" data-state={task.status ?? "none"}>
        {task.run.kind === "none"
          ? "nothing is running"
          : pending && task.status === "in_progress"
            ? "stopping… (not stopped until the run says so)"
            : runWord(task.status)}
      </span>
      {task.interrupt.kind === "refused" ? (
        <span role="alert" className="text-xs text-destructive" data-testid="interrupt-error">
          {task.interrupt.message}
        </span>
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        {["Hand off", "Reassign", "Open PR"].map((label) => (
          <button
            key={label}
            type="button"
            disabled
            title={gaps.task.handOff}
            data-testid="task-disabled-action"
            data-gap={gaps.task.handOff}
            className="rounded-md border px-2.5 py-1 text-xs opacity-50"
          >
            {label}
          </button>
        ))}
      </span>
      <p className="w-full text-[11px] text-muted-foreground" data-testid="task-actions-gap">
        {gaps.task.handOff}
      </p>
    </div>
  );
}

/** Brief (BR-24): the row's fields as stored. */
function Brief({ gaps }: { gaps: Gaps }) {
  const { row } = useTask();
  return (
    <dl className="mx-auto w-full max-w-3xl space-y-3 px-4 py-4 text-sm" data-testid="task-brief">
      <div>
        <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground">TITLE</dt>
        <dd data-testid="brief-title">{row?.title ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground">GOAL</dt>
        <dd className="whitespace-pre-wrap" data-testid="brief-goal">
          {row?.goal ?? "—"}
        </dd>
      </div>
      <div>
        <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground">CONTEXT AND INPUT</dt>
        <dd className="text-muted-foreground" data-testid="brief-fields-gap" data-gap={gaps.task.briefFields}>
          {gaps.task.briefFields}
        </dd>
      </div>
      <div>
        <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground">ACCEPTANCE CRITERIA</dt>
        <dd className="text-muted-foreground" data-testid="brief-acceptance-gap" data-gap={gaps.task.acceptance}>
          {gaps.task.acceptance}
        </dd>
      </div>
    </dl>
  );
}

/** The composer: disabled until something sends a message into a running coding run (BR-16). */
function Composer({ gaps }: { gaps: Gaps }) {
  return (
    <div className="border-t p-3" data-testid="task-composer">
      <textarea
        disabled
        rows={2}
        placeholder="Message this worker…"
        aria-label="Message this worker"
        className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm opacity-60"
        data-testid="task-composer-input"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" data-testid="task-composer-gap" data-gap={gaps.task.composer}>
          {gaps.task.composer}
        </p>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title={gaps.task.alsoPost}>
          <input type="checkbox" disabled data-testid="task-also-post" data-gap={gaps.task.alsoPost} />
          Also post to the workstream
        </label>
        <button type="button" disabled className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground opacity-50">
          Send
        </button>
      </div>
    </div>
  );
}
