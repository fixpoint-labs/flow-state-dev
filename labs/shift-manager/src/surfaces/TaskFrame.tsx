/**
 * The task level (S1, BR-1 to BR-4): the route `/tasks/:boardRef/:taskId/:tab`
 * inside FIX-1662's frame. A header from the row, the one working control
 * (Interrupt), the controls with no shipped operation disabled with their gap
 * line, and four tabs: Session (the run the row names, live), Diff and Checks
 * (named empty states), and Brief (the row as stored). Above the composer, a
 * line says what the worker is doing.
 *
 * What the screen reads is held by {@link TaskProvider}; this file only draws
 * it. The screen writes twice: the abort behind Interrupt, and the composer's
 * message, which goes through the one send path (`lib/send.ts`).
 */
import { useEffect, useState } from "react";
import { EmptyState, ScreenTitle, SectionFailure, StateSquare, Tabs } from "../components/ui";
import { columnFor, isDone, readStatus } from "../lib/columns";
import { asksOfTask, doorOf, rosterOf, seatFor, waited } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { navigate, TASK_TABS, type TaskTab } from "../lib/routes";
import { sendTurn } from "../lib/send";
import { channelOf, useTask } from "../lib/task";
import { TurnComposer } from "../components/TurnComposer";
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

  // The same resolver the inspector and Tasks use, so a name two teams share
  // resolves to the seat in this row's channel, or to no seat at all.
  const seat = row === undefined || snapshot === undefined || snapshot.refused !== undefined || snapshot.unreachable !== undefined ? undefined : seatFor(rosterOf(snapshot), row);
  const worker = row?.assignee == null ? null : (seat?.id ?? row.assignee);

  return (
    // Esc interrupts from anywhere in the frame, on every tab and from the
    // composer, the same as the activity line's hint says.
    <div
      className="flex h-full min-h-0 flex-col outline-none"
      data-testid="task-frame"
      data-board-ref={boardRef}
      data-task-id={taskId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape" && task.run.kind === "open" && task.status === "in_progress") {
          event.preventDefault();
          void task.requestInterrupt();
        }
      }}
    >
      <header className="px-4 pt-3">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">
          TASK ·{" "}
          <button type="button" className="hover:underline" onClick={() => navigate({ level: "workstream", channelId: channelOf(boardRef), tab: "board" })}>
            {boardRef}
          </button>
        </p>
        <ScreenTitle testId="task-title">{row?.title ?? taskId}</ScreenTitle>
        <p className="text-xs text-muted-foreground" data-testid="task-status">
          {row === undefined ? "Not on this board yet." : `${row.status} · ${columnFor(row.status)}`}
          {worker === null ? "" : ` · ${worker}`}
          {row !== undefined && readStatus(row.status) === "in_progress" && row.startedAt !== null ? <Elapsed since={row.startedAt} /> : null}
          {row?.run == null ? "" : ` · attempt ${row.run.attempt}`}
        </p>
        {task.rowFailure === undefined ? null : (
          <div className="mt-2">
            <SectionFailure what="This task's board" failure={task.rowFailure} onRetry={task.retryRow} testId="task-board-failure" />
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
      <Activity worker={worker} />
      <Composer gaps={gaps} worker={worker ?? "This worker"} />
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

/**
 * What the worker is doing, above the composer (v2:428-429): a mark (v2's
 * needs square while the run waits on the person, its run square while it
 * runs), the worker and the run's state, and Esc while it can be stopped.
 */
function Activity({ worker }: { worker: string | null }) {
  const task = useTask();
  const { snapshot } = useLab();
  const pending = task.interrupt.kind === "pending";
  const live = task.run.kind === "open" && task.status === "in_progress";
  const waiting = asksOfTask(snapshot, task.row).length > 0;
  return (
    <div className="flex items-center gap-2 px-[22px] pt-3 font-mono text-[11px] font-medium text-muted-foreground" data-testid="task-activity">
      {waiting ? (
        <StateSquare state="needs" className="size-[7px]" />
      ) : live ? (
        <StateSquare state="run" className="size-[7px]" />
      ) : (
        <span className="inline-block size-[7px] shrink-0 border border-info" data-look="activity-dot" aria-hidden />
      )}
      {worker === null ? null : <span>{worker} ·</span>}
      <span data-testid="run-state" data-state={task.status ?? "none"}>
        {task.run.kind === "none"
          ? "nothing is running"
          : pending && task.status === "in_progress"
            ? "stopping… (not stopped until the run says so)"
            : runWord(task.status)}
      </span>
      {live && !pending ? <span className="ml-auto">esc to interrupt</span> : null}
    </div>
  );
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
        className="border px-2.5 py-1 text-xs font-medium disabled:opacity-50"
        title={running ? "Stop this run (Esc)" : "Nothing is running"}
      >
        {pending ? "Interrupting…" : "Interrupt"}
      </button>
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
            className="border px-2.5 py-1 text-xs opacity-50"
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

/**
 * The composer (BR-18): sends into the session the task's run link names,
 * through the door of the flow that session records as its owner, never the
 * board's. Says why when it can't.
 */
function Composer({ gaps, worker }: { gaps: Gaps; worker: string }) {
  const task = useTask();
  const { clients, snapshot } = useLab();
  const { row } = task;
  const seats =
    snapshot === undefined || snapshot.refused !== undefined || snapshot.unreachable !== undefined
      ? []
      : rosterOf(snapshot).seats;
  const flowId = task.run.kind === "open" ? task.run.run.flowId : undefined;
  const door = flowId === undefined ? null : doorOf(seats, flowId);
  const blocked =
    row === undefined
      ? "This task isn't on its board yet."
      : row.run === null
        ? gaps.turn.notStarted
        : isDone(row.status)
          ? gaps.turn.finished
          : task.run.kind === "failed"
            ? task.run.failure.message
            : flowId === undefined
              ? "Reading the run…"
              : door === null
                ? `${worker} ${gaps.turn.noDoor}`
                : null;
  return (
    <TurnComposer
      testId="task-composer"
      label="Message this worker"
      placeholder="Message this worker…"
      blocked={blocked}
      send={async (message) => {
        await sendTurn(clients, { sessionId: row!.run!.sessionId, flowId: flowId!, door: door! }, message);
      }}
      extra={
        <label className="flex items-center gap-1.5" title={gaps.task.alsoPost}>
          <input type="checkbox" disabled data-testid="task-also-post" data-gap={gaps.task.alsoPost} />
          Also post to the workstream
        </label>
      }
    />
  );
}
