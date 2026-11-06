import { useCallback, useState } from "react";
import { ChevronRightIcon, TerminalIcon } from "lucide-react";
import type { BoardTask, LabAdapter, WorkerRow } from "../adapter";
import type { Look } from "../lib/looks";
import { useNow, useStale, useWatch } from "../lib/use-watch";
import { taskRowPresentation } from "../lib/task-presentation";
import { cn } from "../lib/utils";
import { Avatar } from "./Avatar";
import { STALE_CLASS } from "./flow-state/connection-banner";
import { costAmount, tokenCount } from "./flow-state/spend";
import { TaskTime, taskCounts, taskSignal } from "./flow-state/task-signals";
import { reasonLine, runsOn, taskLabel, taskLine, type Popup } from "./Popups";
import { InstructionsForm } from "./TeammateForms";

/** The heading over each of the panel's sections. */
const HEADING = "font-mono text-[10px] tracking-widest text-muted-foreground uppercase";

/** How many of *Done*'s rows show before *Show all*: the newest few answer "what just finished?". */
const DONE_SHOWN = 5;

/** The dot's fill for each status; a task waiting on you overrides it with `bg-warning`. */
const STATUS_DOT = {
  running: "animate-pulse bg-info",
  done: "bg-success",
  failed: "bg-destructive",
  cancelled: "border border-muted-foreground/60",
} satisfies Record<BoardTask["status"], string>;

/**
 * Newest first: by when it ended, else when it first started, else when it
 * was filed, as the row's view reads them. A retry keeps the first start, so a
 * retried task holds its place. A row with no time keeps its board order,
 * after the timed ones.
 */
function newestFirst(tasks: readonly BoardTask[]): BoardTask[] {
  const at = (t: BoardTask) => t.view?.times.completedAt ?? t.view?.times.startedAt ?? t.view?.times.createdAt ?? undefined;
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const x = at(a.t);
      const y = at(b.t);
      if (x === undefined || y === undefined) return x === y ? a.i - b.i : x === undefined ? 1 : -1;
      return y - x || a.i - b.i;
    })
    .map(({ t }) => t);
}

/**
 * A teammate's tasks, split for the panel, each group newest first: the
 * running ones (those waiting on you first), the failed ones (open: a failure
 * is something to act on), then *Done* and *Cancelled*, each collapsed to its
 * count until opened.
 */
function groupTasks(tasks: readonly BoardTask[]) {
  const of = (status: BoardTask["status"]) => newestFirst(tasks.filter((t) => t.status === status));
  const running = of("running");
  return {
    running: [...running.filter((t) => t.waiting !== undefined), ...running.filter((t) => t.waiting === undefined)],
    failed: of("failed"),
    ended: [
      { status: "done", label: "Done", tasks: of("done") },
      { status: "cancelled", label: "Cancelled", tasks: of("cancelled") },
    ].filter((g) => g.tasks.length > 0),
  };
}

/**
 * The right pane: the selected teammate's panel. At the top, who it is (its
 * name and role) and *Edit instructions*, which opens the instructions form
 * for a teammate you hired; the teammates from the files can't be edited
 * here. Under it, the tasks its conversation filed, coding tasks and
 * teammates' jobs alike, newest first in each group: the running ones
 * (those waiting on you first); the failed ones, open, each with its reason;
 * then *Done* (its newest five, and *Show all*) and *Cancelled*, each one line
 * with its count that opens to its rows. A task that ends moves to its group
 * as its row changes. Each row opens the task in a popup, and carries its
 * time: a running one's clock on this attempt, *quiet* once its run stopped
 * answering, an ended one's age. The heading gives the total and the counts
 * by state. At the foot, a place for its routines, empty for now.
 */
export function TeammatePanel({
  adapter,
  worker,
  sessionId,
  openTask,
  nameOf,
  lookOf,
  isCoding,
  onOpen,
}: {
  adapter: LabAdapter;
  worker: WorkerRow;
  /** The teammate's one conversation: the tasks listed are the ones it filed. */
  sessionId: string;
  /** The task open in the popup, if one is. */
  openTask: string | undefined;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  isCoding: (id: string) => boolean;
  onOpen: (popup: Popup) => void;
}) {
  // The board's read can fail while the conversation's feed is live: its rows are then the last read, and stale too.
  const [boardStale, setBoardStale] = useState(false);
  const watchTasks = useCallback(
    (key: string, onChange: (tasks: BoardTask[]) => void) => {
      setBoardStale(false);
      return adapter.watchTasks(key, onChange, setBoardStale);
    },
    [adapter],
  );
  const tasks = useWatch(watchTasks, sessionId) ?? [];
  const stale = useStale(adapter, sessionId) || boardStale;
  const { running, failed, ended } = groupTasks(tasks);
  // A running clock ticks each second; it holds while the feed is stale, as the status line's age does.
  const now = useNow(1_000, !stale);
  const counts = taskCounts(tasks.flatMap((t) => (t.view === undefined ? [] : [t.view])));
  const [editing, setEditing] = useState(false);
  // Every ended group starts collapsed; a click opens it.
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  // *Done* shows its newest few until *Show all*.
  const [allDone, setAllDone] = useState(false);

  const row = (t: BoardTask) => {
    const coding = isCoding(t.to);
    const line = taskLine(t, coding, nameOf);
    const state = taskRowPresentation(t);
    const reason = t.status === "failed" || t.status === "cancelled" ? reasonLine(t) : undefined;
    return (
      <li key={t.id}>
        <button
          type="button"
          aria-current={t.id === openTask ? "true" : undefined}
          aria-label={coding ? taskLabel(line, t) : line}
          data-task={t.status}
          onClick={() => onOpen({ kind: "task", sessionId, taskId: t.id })}
          className={cn(
            "flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            t.id === openTask && "bg-accent",
            // A stale feed greys the whole row, dot included: STALE_CLASS only reaches descendants.
            stale && STALE_CLASS,
          )}
        >
          <span aria-hidden data-task-dot className={cn("mt-[5px] size-2 shrink-0 rounded-full", t.waiting ? "bg-warning" : STATUS_DOT[t.status])} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="line-clamp-2 text-[13px] leading-snug" title={line}>
              {coding ? <TerminalIcon aria-hidden className="mr-1 mb-0.5 inline size-3 text-muted-foreground" /> : null}
              {line}
            </span>
            <span className={cn("block truncate text-xs", state.tone, stale && STALE_CLASS)} data-status>
              {t.waiting ? state.word : <StatusWords task={t} now={now} stale={stale} />}
              {reason ? ` · ${reason}` : ""}
              {runsOn(t) ? ` · ${runsOn(t)}` : ""}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <aside aria-label={`${worker.name}'s panel`} className="flex h-full min-h-0 flex-col border-l border-border bg-inspector">
      <section aria-label="Teammate" className="flex flex-col gap-2 border-b border-border px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <Avatar look={lookOf(worker.id)} />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{worker.name}</h2>
        </div>
        <p className="text-xs text-muted-foreground">{worker.role}</p>
        {worker.own ? (
          editing ? (
            <InstructionsForm
              name={worker.name}
              onSave={async (instructions) => {
                await adapter.editInstructions(worker.id, instructions);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="w-fit rounded-sm border border-border px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase hover:bg-accent">
              Edit instructions
            </button>
          )
        ) : (
          <>
            <button
              type="button"
              disabled
              aria-describedby="standard-teammate"
              className="w-fit rounded-sm border border-border px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase opacity-40"
            >
              Edit instructions
            </button>
            <p id="standard-teammate" className="text-xs text-muted-foreground">
              {worker.name} comes from the lab's files, so its instructions can't be changed here yet.
            </p>
          </>
        )}
      </section>
      <div className="flex-1 overflow-y-auto pb-4">
        <section aria-labelledby="tasks-heading">
          <div id="tasks-heading" className={cn(HEADING, "px-4 pt-4 pb-2")}>
            Tasks{tasks.length > 0 ? ` (${tasks.length})` : ""}{counts === "" ? "" : ` · ${counts}`}
          </div>
          {tasks.length === 0 ? <p className="px-4 text-xs text-muted-foreground">{worker.name} hasn't started any tasks yet.</p> : null}
          <CodingSpend tasks={tasks.filter((t) => isCoding(t.to))} />
          <div className="space-y-1">
          {running.length > 0 ? <ul aria-label="Running" className="space-y-px px-2">{running.map(row)}</ul> : null}
          {failed.length > 0 ? (
            <div>
              <div className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium">
                <span className="text-destructive">Failed</span>
                <span aria-hidden className="rounded-full bg-destructive/15 px-1.5 text-[10px] leading-4 text-destructive tabular-nums">
                  {failed.length}
                </span>
              </div>
              <ul aria-label="Failed" className="space-y-px px-2 pb-1">{failed.map(row)}</ul>
            </div>
          ) : null}
          {ended.map((group) => {
            const open = opened[group.status] ?? false;
            const capped = group.status === "done" && !allDone && group.tasks.length > DONE_SHOWN;
            const shown = capped ? group.tasks.slice(0, DONE_SHOWN) : group.tasks;
            return (
              <div key={group.status}>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`${group.label} (${group.tasks.length})`}
                  onClick={() => setOpened((o) => ({ ...o, [group.status]: !open }))}
                  className="flex w-full items-center gap-1.5 px-4 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <ChevronRightIcon aria-hidden className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
                  <span>{group.label}</span>
                  <span aria-hidden className="rounded-full bg-muted px-1.5 text-[10px] leading-4 text-muted-foreground tabular-nums">
                    {group.tasks.length}
                  </span>
                </button>
                {open ? <ul aria-label={group.label} className="space-y-px px-2 pb-1">{shown.map(row)}</ul> : null}
                {open && capped ? (
                  <button type="button" onClick={() => setAllDone(true)} className="px-4 py-1 text-left text-xs text-muted-foreground underline-offset-2 hover:underline">
                    Show all {group.tasks.length}
                  </button>
                ) : null}
              </div>
            );
          })}
          </div>
        </section>
        <section aria-labelledby="routines-heading">
          <div id="routines-heading" className={cn(HEADING, "px-4 pt-4 pb-2")}>
            Routines
          </div>
          <p className="px-4 text-xs text-muted-foreground">None yet.</p>
        </section>
      </div>
    </aside>
  );
}

/**
 * A task row's status words with its time: a running one's signal stands in
 * for "running" ("working · 4m 12s", "quiet for 7m"), and an ended one's age
 * follows its status ("done · 12m ago").
 */
function StatusWords({ task, now, stale }: { task: BoardTask; now: number; stale: boolean }) {
  if (task.view === undefined) return <>{task.status}</>;
  const time = <TaskTime view={task.view} run={task.run} now={now} stale={stale} tone={(kind) => taskRowPresentation(task, kind).tone} fallback={task.status} />;
  if (task.status === "running" || taskSignal(task.view, task.run, now, { stale }) === null) return time;
  return (
    <>
      {task.status} · {time}
    </>
  );
}

/**
 * What this conversation's coding tasks spent, all together: their tokens, and
 * the charges vendors reported. Each task's own count is its row's folded view;
 * a task whose runs reported nothing adds nothing, and a subscription run adds
 * tokens but no charge. A total missing a count reads as partial. Nothing shows
 * until a coding task has reported spend. (The registry's line never sums; this
 * total is the panel's own.)
 */
function CodingSpend({ tasks }: { tasks: readonly BoardTask[] }) {
  const line = codingSpendLine(tasks);
  if (line === "") return null;
  return (
    <p className="px-4 pb-2 font-mono text-[10px] text-muted-foreground" data-coding-spend>
      {line}
    </p>
  );
}

/** {@link CodingSpend}'s line, or `""` until some task has reported a count or a charge. Exported for its tests. */
export function codingSpendLine(tasks: readonly BoardTask[]): string {
  const spent = tasks.flatMap((t) => (t.spend === undefined ? [] : [t.spend]));
  // Nothing measured yet, only runs that started: no line, never a measured-looking zero.
  if (!spent.some((s) => s.inputTokens !== null || s.outputTokens !== null || s.costUsd != null)) return "";
  const tokens = spent.reduce((sum, s) => sum + (s.inputTokens ?? 0) + (s.outputTokens ?? 0), 0);
  const charged = spent.filter((s) => s.costUsd != null);
  const cost = charged.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  // Some count still missing, or a source not yet reported: the total is a floor, and says so, as each task's line does.
  const partial = spent.some((s) => s.unreported || s.inputTokens === null || s.outputTokens === null) ? " (partial)" : "";
  return [`Coding tasks: ${tokenCount(tokens)} tokens${partial}`, charged.length === 0 ? null : costAmount(cost)].filter(Boolean).join(" · ");
}
