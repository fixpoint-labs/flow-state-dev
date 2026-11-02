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
 *
 * The keyboard stop is deliberate: Esc twice within the window, or Cmd/Ctrl+.
 * One Esc only dismisses, and an Esc in the composer is the composer's.
 */
import { interruptChordLabel, useInterruptKeys } from "@flow-state-dev/react";
import { useEffect, useState } from "react";
import { EmptyState, ScreenTitle, SectionFailure, StateSquare, Tabs } from "../components/ui";
import { columnFor } from "../lib/columns";
import { asksOfTask, doorOf, rosterOf, workerFor, workerLabel, waited } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { navigate, TASK_TABS, type TaskTab } from "../lib/routes";
import { RouteLink } from "../components/RouteLink";
import { sendTurn } from "../lib/send";
import { useTask } from "../lib/task";
import { distinctTitle } from "../lib/tasks";
import { TurnComposer } from "../components/TurnComposer";
import type { Gaps } from "../gaps";
import { TaskSession } from "./TaskSession";

export function TaskFrame({ tab, gaps }: { tab: TaskTab; gaps: Gaps }) {
  const task = useTask();
  const { snapshot } = useLab();
  const { row, boardRef, taskId } = task;
  const stoppable = task.run.kind === "open" && task.status === "in_progress" && task.interrupt.kind !== "pending";
  const keys = useInterruptKeys({ enabled: stoppable, onInterrupt: () => void task.requestInterrupt() });

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
  // resolves to no worker at all.
  const found = row === undefined || snapshot === undefined || snapshot.refused !== undefined || snapshot.unreachable !== undefined ? undefined : workerFor(rosterOf(snapshot), row);
  const worker = row?.assignee == null ? null : workerLabel(found?.id ?? row.assignee);

  return (
    // Esc Esc or Cmd/Ctrl+. interrupts from anywhere in the frame, on every
    // tab, as the activity line's hint says. A single Esc never does.
    <div
      className="flex h-full min-h-0 flex-col outline-none"
      data-testid="task-frame"
      data-board-ref={boardRef}
      data-task-id={taskId}
      tabIndex={-1}
      onKeyDown={keys.onKeyDown}
    >
      <header className="px-4 pt-3">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">
          TASK ·{" "}
          <RouteLink className="hover:underline" to={{ level: "tasks", by: "state" }}>
            {boardRef}
          </RouteLink>
        </p>
        <ScreenTitle testId="task-title">{row?.title ?? taskId}</ScreenTitle>
        <p className="text-xs text-muted-foreground" data-testid="task-status">
          {row === undefined ? "Not on this board yet." : `${row.status} · ${columnFor(row.status)}`}
          {worker === null ? "" : ` · ${worker}`}
          {row !== undefined && row.status === "in_progress" && row.startedAt !== null ? <Elapsed since={row.startedAt} /> : null}
          {row?.run == null ? "" : ` · attempt ${row.run.attempt}`}
        </p>
        {task.rowFailure === undefined ? null : (
          <div className="mt-2">
            <SectionFailure what="This task's board" failure={task.rowFailure} onRetry={task.retryRow} testId="task-board-failure" />
          </div>
        )}
        <Actions gaps={gaps} />
      </header>
      <Tabs label="Task" tabs={TASK_TABS} selected={tab} onSelect={(next) => /* in place: the task's tabs */ navigate({ level: "task", boardRef, taskId, tab: next })} />
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
      <Activity worker={worker} armed={keys.armed} />
      <Composer gaps={gaps} worker={worker} />
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

/** A record's time on the user's wall clock, HH:MM. */
function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
 * needs square while the run waits on the user, its run square while it
 * runs), the worker and the run's state, and the stop keys while it can be
 * stopped. After an interrupt, the time the run's record says it stopped.
 */
function Activity({ worker, armed }: { worker: string | null; armed: boolean }) {
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
      {task.status === "aborted" && task.stoppedAt !== undefined ? (
        <span data-testid="run-stopped-at">· run stopped at {clockTime(task.stoppedAt)}</span>
      ) : null}
      {live && !pending ? (
        <span className="ml-auto" data-testid="interrupt-hint" data-armed={armed}>
          {armed ? "press Esc again to interrupt" : `esc esc or ${interruptChordLabel()} to interrupt`}
        </span>
      ) : null}
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
        title={running ? `Stop this run (Esc Esc or ${interruptChordLabel()})` : "Nothing is running"}
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
  const title = distinctTitle(row);
  return (
    <dl className="mx-auto w-full max-w-3xl space-y-3 px-4 py-4 text-sm" data-testid="task-brief">
      {title === null ? null : (
        <div>
          <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground">TITLE</dt>
          <dd data-testid="brief-title">{title}</dd>
        </div>
      )}
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
 * board's. Says why when it can't. A finished task takes a message too; what
 * it does is the door's call (FIX-1764).
 */
function Composer({ gaps, worker }: { gaps: Gaps; worker: string | null }) {
  const task = useTask();
  const { client, snapshot, refresh } = useLab();
  const { row } = task;
  const workers =
    snapshot === undefined || snapshot.refused !== undefined || snapshot.unreachable !== undefined
      ? []
      : rosterOf(snapshot).workers;
  const flowId = task.run.kind === "open" ? task.run.run.flowId : undefined;
  const door = flowId === undefined ? null : doorOf(workers, flowId);
  const blocked =
    row === undefined
      ? "This task isn't on its board yet."
      : row.run === null
        ? gaps.turn.notStarted
        : task.run.kind === "failed"
          ? task.run.failure.message
          : flowId === undefined
            ? "Reading the run…"
            : door === null
              ? `${worker ?? "This worker"} ${gaps.turn.noDoor}`
              : null;
  return (
    <TurnComposer
      testId="task-composer"
      draftKey={`task:${task.taskId}`}
      label={`Message ${worker ?? "this worker"}`}
      placeholder={`Message ${worker ?? "this worker"}…`}
      blocked={blocked}
      // No `held`: the draft stays until the door turn ends. The Session follows the request from `onStarted`.
      send={async (message) => {
        const sent = await sendTurn(client, { sessionId: row!.run!.sessionId, flowId: flowId!, door: door! }, message, {
          onStarted: task.noteSent,
        });
        // It stopped short, maybe on a new ask: read the Lab again so Inbox lists whatever it raised.
        if (sent.suspended) void refresh();
        return sent;
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
