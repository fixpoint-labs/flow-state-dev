import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ClockIcon, TerminalIcon } from "lucide-react";
import { useView } from "@flow-state-dev/react";
import { listedRoutineSchema, routinesView, type ListedRoutine, type RosterEntry } from "@flow-state-dev/workforce/browser";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import { useAppClient, useTasks } from "../app";
import { displayName } from "../lib/roster";
import { useNow, useStale } from "../lib/use-watch";
import { attemptStartedAt, elapsedText, holdOf, harnessOf, isActive, isIdle, isLongRunning, modelOf, timeSignalOf, taskStatus, workerOf } from "../lib/task";
import { clearMark, useCleared } from "../lib/cleared";
import { taskPresentation } from "../lib/task-presentation";
import { cn } from "../lib/utils";
import { STALE_CLASS } from "./flow-state/connection-banner";
import { costAmount, tokenCount, tokenTotal } from "./flow-state/spend";
import { taskSignal } from "./flow-state/task-signals";
import { reasonLine, type Popup } from "./Popups";
import { taskLabel, taskLine } from "./TaskCard";
import { PullRequestsList } from "./PullRequestsList";
import { PANEL_TABS, usePanelTab, type PanelTab } from "../lib/panel-tab";
import { isOpenPullRequest, useTeammatePullRequests } from "../lib/pull-requests";

/**
 * How many of *Failed*'s and *Done*'s rows show before *Show all*: the newest
 * few answer "what just broke?" and "what just finished?". Running tasks are
 * never capped.
 */
const NEWEST_SHOWN = 5;

/** The panel's status filters, in tab order. Each is a tab: the only way to pick which tasks show. */
const FILTERS = [
  { status: "running", label: "Running" },
  { status: "idle", label: "Idle" },
  { status: "failed", label: "Failed" },
  { status: "done", label: "Done" },
] as const;
type Filter = (typeof FILTERS)[number]["status"];

/** The panel's own tabs' names, in {@link PANEL_TABS}' order. */
const PANEL_LABELS: Record<PanelTab, string> = { tasks: "Tasks", routines: "Routines", "pull-requests": "Pull Requests" };

/** What an empty tab says. */
const EMPTY: Record<Filter, string> = { running: "No running tasks.", idle: "No idle tasks.", failed: "No failed tasks.", done: "Nothing done yet." };

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
 * running ones (those waiting on you first), the idle ones (open, but nothing
 * moves until something outside does: a pull request open), the failed ones less those the
 * viewer cleared, and the done ones: completed, cancelled, and failed ones
 * the viewer cleared. Every ended task lands in one tile, so finished work
 * stays findable and *Clear* moves a failure out of the way, never out of
 * reach.
 */
function groupTasks(tasks: readonly CodingBoardTask[], cleared: ReadonlySet<string>): Record<Filter, CodingBoardTask[]> {
  const of = (status: ReturnType<typeof taskStatus>) => newestFirst(tasks.filter((t) => taskStatus(t) === status));
  const open = of("running");
  const running = open.filter(isActive);
  const isCleared = (t: CodingBoardTask) => taskStatus(t) === "failed" && cleared.has(clearMark(t));
  return {
    running: [...running.filter((t) => holdOf(t) !== undefined), ...running.filter((t) => holdOf(t) === undefined)],
    idle: open.filter(isIdle),
    failed: of("failed").filter((t) => !isCleared(t)),
    done: newestFirst(tasks.filter((t) => taskStatus(t) === "done" || taskStatus(t) === "cancelled" || isCleared(t))),
  };
}

/**
 * The right pane: three tabs, *Tasks*, *Routines* and *Pull Requests*, each
 * counted (all tasks, the routines, the open pull requests), the open one kept
 * per teammate in this browser. A tab you are not on carries a dot when
 * something in it waits on you. *Pull Requests* lists what the runs of this
 * conversation's tasks recorded opening (`PullRequestsList`).
 *
 * *Tasks*: a segmented bar of four counted tabs, *Running*, *Idle*, *Failed* and *Done*, which
 * pick which tasks show: the selected one lists its tasks as cards, newest first
 * (running ones waiting on you first). *Failed* and *Done* show their newest
 * five, with *Show all* / *Show fewer*. *Failed* has *Clear*, which moves its
 * tasks to *Done* in this browser; the tasks themselves are unchanged. *Done*
 * holds completed and cancelled tasks too, a cancelled one marked so on its
 * card. A card opens its task in the sheet beside the panel, or closes it when it is the open one, and carries its time: an
 * active one's clock on this attempt, with a thin bar while its run answers,
 * and *Long-running* once it has been open a day; an idle one's time since it
 * last moved; an ended one's age. Then
 * what this conversation's coding tasks spent. *Routines*: each clock routine
 * it files and event routine it hears, with when it next runs or what it
 * follows, and *Paused* on a paused one.
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
  /** The task open in the sheet, if one is: its card is marked. */
  openTask: string | undefined;
  nameOf: (id: string) => string;
  isCoding: (id: string) => boolean;
  onOpen: (popup: Popup) => void;
  /** *New routine*: routines are asked for in words, so this hands the teammate's composer a start. */
  onNewRoutine?: () => void;
}) {
  // The board's read can fail while the conversation's feed is live: its rows are then the last read, and stale too.
  const board = useTasks(sessionId);
  // Its routines: Workforce's routines view, read with no session, kept to the ones acting through this teammate.
  const { client, pollIntervalMs } = useAppClient();
  const listed = useView(routinesView, {}, { client, pollIntervalMs }).value;
  const routines = useMemo(() => routinesOf(listed, worker.id), [listed, worker.id]);
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
  const tabs = useRef<Record<Filter, HTMLButtonElement | null>>({ running: null, idle: null, failed: null, done: null });
  const name = displayName(worker);
  // The panel's own tabs, the open one kept per teammate; the pull requests its tasks' runs recorded, newest task first.
  const [panelTab, setPanelTab] = usePanelTab(worker.id);
  const panelTabs = useRef<Record<PanelTab, HTMLButtonElement | null>>({ tasks: null, routines: null, "pull-requests": null });
  const pullRequests = useTeammatePullRequests(useMemo(() => newestFirst(tasks), [tasks]));
  const panelCounts: Record<PanelTab, number> = { tasks: tasks.length, routines: routines.length, "pull-requests": pullRequests?.filter(isOpenPullRequest).length ?? 0 };
  // Something in the tab waits on you: a running task's hold, or a pull request whose task holds one.
  const panelAttention: Record<PanelTab, boolean> = {
    tasks: tasks.some((t) => taskStatus(t) === "running" && holdOf(t) !== undefined),
    routines: false,
    "pull-requests": pullRequests?.some((pr) => pr.attention) ?? false,
  };
  const onPanelTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = PANEL_TABS[(PANEL_TABS.indexOf(panelTab) + step + PANEL_TABS.length) % PANEL_TABS.length]!;
    setPanelTab(next);
    panelTabs.current[next]?.focus();
  };

  const shown = CAPPED.has(filter) && !showAll ? groups[filter].slice(0, NEWEST_SHOWN) : groups[filter];

  // Arrow keys move between the tabs, as a tab list's do; the selection follows focus.
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
    const active = isActive(t);
    const runs = { harness: harnessOf(t), model: modelOf(t) };
    const { view, run } = timeSignalOf(t);
    const signal = taskSignal(view, run, now, { stale });
    const long = isLongRunning(t, now);
    const start = attemptStartedAt(t);
    const elapsed = elapsedOf(t, start, now, signal);
    const tokens = tokenTotal(t.spend);
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
            "relative flex w-full flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-left shadow-(--shadow-card) transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring",
            // The task open in the sheet beside the panel: ringed, with a mark pointing at the sheet.
            t.id === openTask && "border-info ring-1 ring-info",
            // A stale feed greys the whole card: STALE_CLASS only reaches descendants.
            stale && STALE_CLASS,
          )}
        >
          {t.id === openTask ? (
            <span aria-hidden data-open-mark className="absolute top-1/2 -left-2 -translate-y-1/2 border-y-[5px] border-r-[6px] border-y-transparent border-r-info" />
          ) : null}
          <span className="flex items-start justify-between gap-3">
            <span className="line-clamp-2 text-sm leading-snug font-medium" title={line}>
              {coding ? t.title : line}
            </span>
            {elapsed === undefined ? null : (
              <span className={cn("shrink-0 pt-px font-mono text-xs tabular-nums", active && signal?.kind !== "idle" ? "text-brand" : "text-text-3")} data-elapsed>
                {elapsed}
              </span>
            )}
          </span>
          {active && signal?.kind === "working" && !long ? (
            <span aria-hidden className="block h-0.5 overflow-hidden rounded-full bg-border" data-progress>
              <span className="block h-full w-1/3 animate-pulse rounded-full bg-brand" />
            </span>
          ) : null}
          <span className="flex min-w-0 items-center gap-2 text-xs text-text-3">
            {coding ? <TerminalIcon aria-hidden className="size-3 shrink-0" /> : null}
            {meta.length > 0 ? <span className="min-w-0 truncate font-mono">{meta.join(" · ")}</span> : null}
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {words === undefined ? null : (
                <span className={cn("max-w-[14rem] truncate rounded-full px-1.5 py-px", words.pill, stale && STALE_CLASS)} data-status title={words.text}>
                  {words.text}
                </span>
              )}
              {long ? (
                <span className="rounded-full bg-muted px-1.5 py-px text-text-2" data-long-running>
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
      <div role="tablist" aria-label="Panel" className="flex shrink-0 gap-5 border-b border-border px-4" onKeyDown={onPanelTabKey}>
        {PANEL_TABS.map((id) => {
          const selected = panelTab === id;
          return (
            <button
              key={id}
              ref={(el) => {
                panelTabs.current[id] = el;
              }}
              type="button"
              role="tab"
              id={`panel-tab-${id}`}
              aria-selected={selected}
              aria-controls="panel-tabpanel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setPanelTab(id)}
              className={cn(
                "relative -mb-px flex items-center gap-1.5 border-b-2 pt-3.5 pb-2.5 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                selected ? "border-brand font-semibold text-foreground" : "border-transparent text-text-2 hover:text-foreground",
              )}
            >
              {PANEL_LABELS[id]}{" "}
              <span className="font-mono text-xs font-normal text-text-3 tabular-nums">{panelCounts[id]}</span>
              {/* A tab you are not on holds something waiting on you: the highlighter's dot. */}
              {!selected && panelAttention[id] ? (
                <span data-attention role="img" aria-label="needs you" className="absolute top-2.5 -right-2 size-1.5 rounded-full bg-attention ring-2 ring-inspector" />
              ) : null}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id="panel-tabpanel" aria-labelledby={`panel-tab-${panelTab}`} className="flex-1 overflow-y-auto px-4 pt-4 pb-4">
        {panelTab === "tasks" ? (
          <section aria-label="Tasks" className="flex flex-col gap-3">
            <div role="tablist" aria-label="Task status" className="grid grid-cols-4 gap-0.5 rounded-lg bg-muted p-0.5" onKeyDown={onTabKey}>
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
                      "flex min-w-0 items-center justify-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                      selected ? "bg-card font-medium text-brand shadow-(--shadow-card)" : "text-text-2 hover:text-foreground",
                    )}
                  >
                    {label}
                    <span className="font-mono tabular-nums">{groups[status].length}</span>
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
        ) : null}
        {panelTab === "routines" ? (
          <section aria-label="Routines" className="flex flex-col gap-3">
            {routines.length > 0 ? (
              <ul aria-label={`${name}'s routines`} className="flex flex-col gap-2">
                {routines.map((r) => (
                  <li key={r.id} data-routine={r.id} className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2.5 text-xs">
                    <span className="flex items-center gap-2 font-medium">
                      <ClockIcon aria-hidden className="size-3.5 shrink-0 text-text-3" />
                      <span className="min-w-0 truncate">{r.name}</span>
                      {r.paused ? <span className="ml-auto rounded-sm bg-muted px-1.5 text-text-3">Paused</span> : null}
                    </span>
                    <span className="text-text-2">{routineWhen(r)}</span>
                    {r.description === undefined ? null : <span className="line-clamp-2 text-text-3">{r.description}</span>}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border-strong p-3">
              <p className="flex items-start gap-2.5 text-xs text-text-2">
                <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-text-3">
                  <ClockIcon className="size-3.5" />
                </span>
                Schedule a routine for {name}.
              </p>
              {onNewRoutine === undefined ? null : (
                <button type="button" onClick={onNewRoutine} aria-label="New routine" className="rounded-md border border-border-strong px-3 py-1 text-xs font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
                  + New routine
                </button>
              )}
            </div>
          </section>
        ) : null}
        {panelTab === "pull-requests" ? <PullRequestsList rows={pullRequests} sessionId={sessionId} onOpen={onOpen} /> : null}
      </div>
    </aside>
  );
}

/**
 * The routines a routines view answered that act through `workerId` (a clock
 * routine it files, an event routine it hears), in the view's order, each
 * parsed by Workforce's own schema; one that doesn't parse is left out.
 */
function routinesOf(output: unknown, workerId: string): ListedRoutine[] {
  const rows = (output as { routines?: unknown } | null | undefined)?.routines;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const parsed = listedRoutineSchema.safeParse(row);
    return parsed.success && parsed.data.worker === workerId ? [parsed.data] : [];
  });
}

/**
 * When a routine acts, in a line: a clock routine's cron and zone, and its next
 * run (none while paused); an event routine's thread.
 */
export function routineWhen(r: ListedRoutine): string {
  if ("event" in r.trigger) return `Follows ${r.trigger.event.thread}`;
  const { cron, timezone, nextRunAt } = r.trigger.clock;
  const next = nextRunAt === null ? "" : ` · next ${new Date(nextRunAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
  return `${cron} (${timezone})${next}`;
}

const PANEL_BUTTON = "w-fit rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring";

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

/** A card's time: an active task's clock on this attempt; an idle one's time since it last moved; an ended one's age, as its signal reads it. */
function elapsedOf(task: CodingBoardTask, start: number | undefined, now: number, signal: ReturnType<typeof taskSignal>): string | undefined {
  if (isIdle(task)) return task.updatedAt == null ? undefined : elapsedText(now - task.updatedAt);
  // A running task no run holds (parked, owing a turn) shows how long it has been idle, never a running clock.
  if (isActive(task) && signal?.kind === "idle") return signal.text;
  if (isActive(task)) return start === undefined ? undefined : elapsedText(now - start);
  return signal?.kind === "ended" ? signal.text : undefined;
}

/**
 * What a card says of how its task stands, beside its meta, when that adds to
 * its time: *waiting on you* (the user must act), what an idle one waits
 * on (*PR open*), how long a run has been quiet, a failed or cancelled task's reason. A running task whose run
 * answers says nothing more: its clock and bar say it.
 */
function cardWords(task: CodingBoardTask, quiet: string | undefined): { text: string; pill: string } | undefined {
  const status = taskStatus(task);
  if (holdOf(task) || isIdle(task)) {
    const { word, pill } = taskPresentation(task);
    return { text: word, pill };
  }
  if (status === "running") return quiet === undefined ? undefined : { text: quiet, pill: taskPresentation(task, "quiet").pill };
  if (status === "failed" || status === "cancelled") {
    const reason = reasonLine(task);
    return { text: reason ? `${status} · ${reason}` : status, pill: taskPresentation(task).pill };
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
