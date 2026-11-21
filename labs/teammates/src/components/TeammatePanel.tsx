import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CheckIcon, ClockIcon, TerminalIcon } from "lucide-react";
import type { RosterEntry } from "@flow-state-dev/workforce/browser";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { useTasks } from "../app";
import { displayName } from "../lib/roster";
import { useNow, useStale } from "../lib/use-watch";
import { attemptStartedAt, elapsedText, holdOf, harnessOf, isLongRunning, modelOf, timeSignalOf, taskStatus, workerOf } from "../lib/task";
import { clearMark, useCleared } from "../lib/cleared";
import { taskPresentation } from "../lib/task-presentation";
import { cn } from "../lib/utils";
import { STALE_CLASS } from "./flow-state/connection-banner";
import { costAmount, tokenCount } from "./flow-state/spend";
import { taskSignal } from "./flow-state/task-signals";
import { reasonLine, type Popup } from "./Popups";
import { taskLabel, taskLine } from "./TaskCard";

/**
 * How many of *Failed*'s and *Done*'s rows show before *Show all*: the newest
 * few answer "what just broke?" and "what just finished?". Running tasks are
 * never capped.
 */
const NEWEST_SHOWN = 5;

/** The panel's status filters, in tile order. Each tile is a tab: the only way to pick which tasks show. */
const FILTERS = [
  { status: "running", label: "Running" },
  { status: "failed", label: "Failed" },
  { status: "done", label: "Done" },
] as const;
type Filter = (typeof FILTERS)[number]["status"];

/** Each filter's marker, labelled by its tile's word: a green dot, a red square, a check. */
const MARKER: Record<Filter, string> = {
  running: "size-1.5 rounded-full bg-success",
  failed: "size-1.5 rounded-[1px] bg-danger",
  done: "size-3 text-text-3",
};

/** What an empty tab says. */
const EMPTY: Record<Filter, string> = { running: "No running tasks.", failed: "No failed tasks.", done: "Nothing done yet." };

/** The tabs whose lists show their newest {@link NEWEST_SHOWN} until *Show all*. */
const CAPPED: ReadonlySet<Filter> = new Set(["failed", "done"]);

/**
 * Newest first: by when it ended, else when it first started, else when it
 * was filed, as the row's view reads them. A retry keeps the first start, so a
 * retried task holds its place. A row with no time keeps its board order,
 * after the timed ones.
 */
function newestFirst(tasks: readonly CodingBoardTask[]): CodingBoardTask[] {
  const at = (t: CodingBoardTask) => t.completedAt ?? t.startedAt ?? t.createdAt ?? undefined;
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
 * A teammate's tasks, split by the panel's filters, each newest first: the
 * running ones (those waiting on you first), the failed ones less those the
 * viewer cleared, and the done ones: completed, cancelled, and failed ones
 * the viewer cleared. Every ended task lands in one tile, so finished work
 * stays findable and *Clear* moves a failure out of the way, never out of
 * reach.
 */
function groupTasks(tasks: readonly CodingBoardTask[], cleared: ReadonlySet<string>): Record<Filter, CodingBoardTask[]> {
  const of = (status: ReturnType<typeof taskStatus>) => newestFirst(tasks.filter((t) => taskStatus(t) === status));
  const running = of("running");
  const isCleared = (t: CodingBoardTask) => taskStatus(t) === "failed" && cleared.has(clearMark(t));
  return {
    running: [...running.filter((t) => holdOf(t) !== undefined), ...running.filter((t) => holdOf(t) === undefined)],
    failed: of("failed").filter((t) => !isCleared(t)),
    done: newestFirst(tasks.filter((t) => taskStatus(t) === "done" || taskStatus(t) === "cancelled" || isCleared(t))),
  };
}

/**
 * The right pane: the selected teammate's tasks. Its heading gives the total.
 * Under it, three count tiles, *Running*, *Failed* and *Done*, which are the
 * panel's tabs: the selected one lists its tasks as cards, newest first
 * (running ones waiting on you first). *Failed* and *Done* show their newest
 * five, with *Show all* / *Show fewer*. *Failed* has *Clear*, which moves its
 * tasks to *Done* in this browser; the tasks themselves are unchanged. *Done*
 * holds completed and cancelled tasks too, a cancelled one marked so on its
 * card. A card opens its task in a popup and carries its time: an
 * active one's clock on this attempt, with a thin bar while its run answers,
 * and *Long-running* once it has been open a day; an ended one's age. Then
 * what this conversation's coding tasks spent, and at the foot its routines.
 * The teammate's own description and *Edit* live in the conversation's header.
 */
export function TeammatePanel({
  worker,
  sessionId,
  openTask,
  isCoding,
  nameOf,
  onOpen,
  onNewRoutine,
}: {
  worker: RosterEntry;
  /** The teammate's one conversation: the tasks listed are the ones it filed. */
  sessionId: string;
  /** The task open in the popup, if one is. */
  openTask: string | undefined;
  nameOf: (id: string) => string;
  isCoding: (id: string) => boolean;
  onOpen: (popup: Popup) => void;
  /** *New routine*: routines are asked for in words, so this hands the teammate's composer a start. */
  onNewRoutine?: () => void;
}) {
  // The board's read can fail while the conversation's feed is live: its rows are then the last read, and stale too.
  const board = useTasks(sessionId);
  const tasks = useMemo(() => board.value ?? [], [board.value]);
  const stale = useStale(sessionId) || board.stale;
  const [cleared, clearFailed] = useCleared(sessionId);
  // The clock below re-renders the panel each second; the grouping only changes with the board or what was cleared.
  const groups = useMemo(() => groupTasks(tasks, cleared), [tasks, cleared]);
  // A running clock ticks each second; it holds while the feed is stale, as the status line's age does.
  const now = useNow(1_000, !stale);
  const [filter, setFilter] = useState<Filter>("running");
  // *Failed* and *Done* show their newest few until *Show all*, and fold back with *Show fewer*.
  const [expanded, setExpanded] = useState<Filter>();
  const showAll = expanded === filter;
  const tabs = useRef<Record<Filter, HTMLButtonElement | null>>({ running: null, failed: null, done: null });
  const name = displayName(worker);

  const shown = CAPPED.has(filter) && !showAll ? groups[filter].slice(0, NEWEST_SHOWN) : groups[filter];

  // Arrow keys move between the tiles, as a tab list's do; the selection follows focus.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const i = FILTERS.findIndex((f) => f.status === filter);
    const next = FILTERS[(i + step + FILTERS.length) % FILTERS.length]!.status;
    setFilter(next);
    tabs.current[next]?.focus();
  };

  const card = (t: CodingBoardTask) => {
    const coding = isCoding(workerOf(t));
    const line = taskLine({ title: t.title, to: workerOf(t) }, coding, nameOf);
    const status = taskStatus(t);
    const runs = { harness: harnessOf(t), model: modelOf(t) };
    const { view, run } = timeSignalOf(t);
    const signal = taskSignal(view, run, now, { stale });
    const long = isLongRunning(t, now);
    const start = attemptStartedAt(t);
    // An active task's clock on this attempt; an ended one's age, as its signal reads it.
    // A running task no run holds shows how long it has been idle, never a running clock.
    const idle = status === "running" && signal?.kind === "idle";
    const elapsed = idle ? signal.text : status === "running" ? (start === undefined ? undefined : elapsedText(now - start)) : signal?.kind === "ended" ? signal.text : undefined;
    const tokens = t.spend == null || (t.spend.inputTokens === null && t.spend.outputTokens === null) ? undefined : tokenCount((t.spend.inputTokens ?? 0) + (t.spend.outputTokens ?? 0));
    const meta = [runs.harness, runs.model, tokens].filter((x): x is string => x !== undefined);
    const words = cardWords(t, signal?.kind === "quiet" ? signal.text : undefined);
    return (
      <li key={t.id}>
        <button
          type="button"
          aria-current={t.id === openTask ? "true" : undefined}
          aria-label={coding ? taskLabel(line, runs) : line}
          data-task={status}
          onClick={() => onOpen({ kind: "task", sessionId, taskId: t.id })}
          className={cn(
            "flex w-full flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            t.id === openTask && "border-border-strong bg-surface-raised",
            // A stale feed greys the whole card: STALE_CLASS only reaches descendants.
            stale && STALE_CLASS,
          )}
        >
          <span className="flex items-start justify-between gap-3">
            <span className="line-clamp-2 text-sm leading-snug font-medium" title={line}>
              {coding ? t.title : line}
            </span>
            {elapsed === undefined ? null : (
              <span className={cn("shrink-0 pt-px font-mono text-xs tabular-nums", long ? "text-warning-text" : status === "running" && !idle ? "text-success-text" : "text-text-3")} data-elapsed>
                {elapsed}
              </span>
            )}
          </span>
          {status === "running" && signal?.kind === "working" && !long ? (
            <span aria-hidden className="block h-0.5 overflow-hidden rounded-full bg-border" data-progress>
              <span className="block h-full w-1/3 animate-pulse rounded-full bg-success" />
            </span>
          ) : null}
          <span className="flex min-w-0 items-center gap-2 text-xs text-text-3">
            {coding ? <TerminalIcon aria-hidden className="size-3 shrink-0" /> : null}
            {meta.length > 0 ? <span className="min-w-0 truncate font-mono">{meta.join(" · ")}</span> : null}
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {words === undefined ? null : (
                <span className={cn("max-w-[14rem] truncate", words.tone, stale && STALE_CLASS)} data-status title={words.text}>
                  {words.text}
                </span>
              )}
              {long ? (
                <span className="rounded-sm border border-warning-line bg-warning-soft px-1.5 py-px text-warning-text" data-long-running>
                  Long-running
                </span>
              ) : null}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <aside aria-label={`${name}'s panel`} className="flex h-full min-h-0 flex-col border-l border-border bg-inspector">
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-4">
        <section aria-labelledby="tasks-heading" className="flex flex-col gap-3">
          <h2 id="tasks-heading" className="text-sm font-semibold">
            Tasks <span className="font-normal text-text-3 tabular-nums">{tasks.length}</span>
          </h2>
          <div role="tablist" aria-label="Task status" className="grid grid-cols-3 gap-1.5" onKeyDown={onTabKey}>
            {FILTERS.map(({ status, label }) => {
              const selected = filter === status;
              return (
                <button
                  key={status}
                  ref={(el) => {
                    tabs.current[status] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`tasks-tab-${status}`}
                  aria-selected={selected}
                  aria-controls="tasks-tabpanel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setFilter(status)}
                  className={cn(
                    "flex min-w-0 flex-col items-start gap-1 rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                    selected ? "border-border-strong bg-surface-raised" : "border-border bg-transparent hover:bg-surface",
                  )}
                >
                  <span className="text-xl leading-none font-semibold tabular-nums">{groups[status].length}</span>
                  <span className="flex min-w-0 max-w-full items-center gap-1.5 text-xs whitespace-nowrap text-text-2">
                    {status === "done" ? <CheckIcon aria-hidden strokeWidth={2.5} className={cn("shrink-0", MARKER.done)} /> : <span aria-hidden className={cn("shrink-0", MARKER[status])} />}
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
          <CodingSpend tasks={tasks.filter((t) => isCoding(workerOf(t)))} />
          <div role="tabpanel" id="tasks-tabpanel" aria-labelledby={`tasks-tab-${filter}`} className="flex flex-col gap-2">
            {filter === "failed" && groups.failed.length > 0 ? (
              <button
                type="button"
                aria-label={`Clear failed (${groups.failed.length})`}
                title="Move these to Done, in this browser. The tasks themselves stay."
                onClick={() => clearFailed(groups.failed.map(clearMark))}
                className="self-end text-xs text-text-3 underline-offset-2 hover:text-foreground hover:underline"
              >
                Clear
              </button>
            ) : null}
            {shown.length === 0 ? (
              <p className="text-xs text-text-3">{tasks.length === 0 ? `${name} hasn't started any tasks yet.` : EMPTY[filter]}</p>
            ) : (
              <ul aria-label={FILTERS.find((f) => f.status === filter)!.label} className="flex flex-col gap-2">
                {shown.map(card)}
              </ul>
            )}
            {CAPPED.has(filter) && groups[filter].length > NEWEST_SHOWN ? (
              <button
                type="button"
                aria-expanded={showAll}
                onClick={() => setExpanded(showAll ? undefined : filter)}
                className="self-start text-xs text-text-3 underline-offset-2 hover:text-foreground hover:underline"
              >
                {showAll ? "Show fewer" : `Show all ${groups[filter].length}`}
              </button>
            ) : null}
          </div>
        </section>
        <section aria-labelledby="routines-heading" className="mt-6 flex flex-col gap-3 border-t border-border pt-5">
          <h2 id="routines-heading" className="text-sm font-semibold">
            Routines
          </h2>
          <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-border-strong p-3">
            <p className="flex items-start gap-2.5 text-xs text-text-2">
              <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-sm bg-surface text-text-3">
                <ClockIcon className="size-3.5" />
              </span>
              Schedule a routine for {name}.
            </p>
            {onNewRoutine === undefined ? null : (
              <button type="button" onClick={onNewRoutine} className="rounded-sm border border-border-strong px-3 py-1 text-xs font-medium hover:bg-surface-raised">
                New routine
              </button>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}

const PANEL_BUTTON = "w-fit rounded-sm border border-border px-2 py-0.5 font-mono text-xs tracking-widest uppercase hover:bg-accent disabled:opacity-40";

/**
 * Put a file's teammate the user edited back as the file has it: their copy
 * goes, and its next turn reads the file's name and instructions. Drawn by
 * the conversation's header, beside *Edit teammate*.
 */
export function ResetButton({ name, onReset }: { name: string; onReset: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const reset = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onReset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" disabled={busy} onClick={() => void reset()} aria-label={`Reset ${name} to default`} className={PANEL_BUTTON}>
        Reset to default
      </button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

/**
 * What a card says of how its task stands, beside its meta, when that adds to
 * its time: *waiting on you* (the user must act), how long a run has been
 * quiet, a failed or cancelled task's reason. A running task whose run
 * answers says nothing more: its clock and bar say it.
 */
function cardWords(task: CodingBoardTask, quiet: string | undefined): { text: string; tone: string } | undefined {
  const status = taskStatus(task);
  if (holdOf(task)) {
    const { word, tone } = taskPresentation(task);
    return { text: word, tone };
  }
  if (status === "running") return quiet === undefined ? undefined : { text: quiet, tone: taskPresentation(task, "quiet").tone };
  if (status === "failed" || status === "cancelled") {
    const reason = reasonLine(task);
    return { text: reason ? `${status} · ${reason}` : status, tone: taskPresentation(task).tone };
  }
  return undefined;
}

/**
 * What this conversation's coding tasks spent, all together: their tokens, and
 * the charges vendors reported. Each task's own count is its row's folded view;
 * a task whose runs reported nothing adds nothing, and a subscription run adds
 * tokens but no charge. A total missing a count reads as partial. Nothing shows
 * until a coding task has reported spend. (The registry's line never sums; this
 * total is the panel's own.)
 */
function CodingSpend({ tasks }: { tasks: readonly CodingBoardTask[] }) {
  const value = codingSpendLine(tasks);
  if (value === "") return null;
  return (
    <p className="flex items-baseline justify-between gap-3 text-xs text-text-3" data-coding-spend>
      <span>Coding tokens</span>
      <span className="font-mono text-text-2 tabular-nums" data-coding-spend-value>
        {value}
      </span>
    </p>
  );
}

/**
 * {@link CodingSpend}'s figure, "87.6M · $1.20 · partial": the tokens, the
 * charge when any task reported one, and *partial* while a count is missing.
 * `""` until some task has reported a count or a charge. Exported for its tests.
 */
export function codingSpendLine(tasks: readonly Pick<CodingBoardTask, "spend">[]): string {
  const spent = tasks.flatMap((t) => (t.spend == null ? [] : [t.spend]));
  // Nothing measured yet, only runs that started: no line, never a measured-looking zero.
  if (!spent.some((s) => s.inputTokens !== null || s.outputTokens !== null || s.costUsd != null)) return "";
  const tokens = spent.reduce((sum, s) => sum + (s.inputTokens ?? 0) + (s.outputTokens ?? 0), 0);
  const charged = spent.filter((s) => s.costUsd != null);
  const cost = charged.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  // Some count still missing, or a source not yet reported: the total is a floor, and says so, as each task's line does.
  const partial = spent.some((s) => s.unreported || s.inputTokens === null || s.outputTokens === null);
  return [tokenCount(tokens), charged.length === 0 ? null : costAmount(cost), partial ? "partial" : null].filter(Boolean).join(" · ");
}
