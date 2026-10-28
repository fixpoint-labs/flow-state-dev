/**
 * Task Collections view (FIX-445).
 *
 * Developer-mode panel that surfaces every TaskCollection referenced by the
 * active session's items. Auto-discovery is by `data.collectionId` on
 * `task-change` and `task-board-meta` component items — pattern-agnostic, so
 * any consumer of the unified Plan/Task substrate (FIX-444) shows up here.
 *
 * The presentation is intentionally raw: full Task fields, all statuses
 * including cancelled/errored, and the latest TaskChangeKind. The polished
 * `<TaskPlan />` renderer is what apps embed in their chat UI; this panel is
 * for debugging the substrate itself.
 *
 * A task whose worker dispatches its rows to a `task` entry is run by a dispatch run
 * rather than by the request you are looking at, so its row carries a link into that
 * dispatch run (FIX-1071). The link is derived, absent for most tasks, and never
 * something the row is gated on — see `lib/dispatch-run-links`.
 *
 * A task also carries a short note about itself on `feedback`, and the row's
 * reason slot renders it so a retried row says why without being opened
 * (FIX-1481). A task waiting on a person shows what it was asked there
 * instead (`waitPrompt`): its open question, or its run's stop. The slot is keyed on the field being present, never on a
 * status, and the note is rendered exactly as stored — see
 * `showReason` in `CollectionCard` for why both of those are load-bearing.
 *
 * Each task is one row that opens in place, like an accordion (FIX-1629). The
 * collapsed row leads with status, then goal and reason sharing the width, so
 * the reason is in view on a laptop-width pane; the open row is
 * `task-row-body`. Open rows are held here, keyed by board and task id, so a
 * streamed change re-renders a row without closing it.
 */
import { Component, useCallback, useId, useMemo, useState, type ReactNode } from "react";
import type { ActionInputSchema, ChildSessionSummary } from "@flow-state-dev/client";
import { ChevronRight, ClipboardList, Layers } from "lucide-react";
import {
  groupCollections,
  type BoardMeta,
  type CollectionView,
  type ResolvedTask,
  type TaskStreamItem,
  waitPrompt,
} from "../../lib/task-collection-state";
import {
  decodeDispatchRunEntry,
  linkDispatchRunsToTasks,
  taskLinkKey,
} from "../../lib/dispatch-run-links";
import type { Truncation } from "../../hooks/use-dispatch-runs";
import { EmptyState } from "../shared/empty-state";
import { TaskRowBody } from "./task-row-body";
import { TaskRowActions, type RowDispatch } from "./task-row-actions";
import { taskActionsFor, type RequestOutcomeSource } from "../../lib/task-actions";

/**
 * What a row needs to change its task: the viewed flow's actions, the panel's
 * dispatch, and the session's requests to read an outcome from. Absent, rows
 * are read-only and show no Actions strip.
 */
export type RowActions = {
  names: readonly string[];
  schemas?: Record<string, ActionInputSchema>;
  run: (action: string, input: unknown) => Promise<RowDispatch>;
  requests: readonly RequestOutcomeSource[];
};

type Props = {
  /**
   * Flat list of items the user is currently inspecting (across all requests).
   * The panel memoizes this list, so the folds below hold across renders.
   */
  items: ReadonlyArray<TaskStreamItem>;
  /**
   * The open session's background work, so a task run by one can say so.
   * Omitted (or empty) leaves every row exactly as it was.
   */
  dispatchRuns?: readonly ChildSessionSummary[];
  /**
   * What is known about dispatch runs beyond the page that was read. An
   * unmatched task is only definitely unmatched when this is `complete`.
   */
  truncation: Truncation;
  /** Open the dispatch run running a task. */
  onOpenDispatchRun: (dispatchRun: ChildSessionSummary) => void;
  /** The viewed flow's task actions. Omitted, rows only read. */
  rowActions?: RowActions;
};

export function TaskCollectionsView({
  items,
  dispatchRuns,
  truncation,
  onOpenDispatchRun,
  rowActions,
}: Props) {
  const collections = useMemo(() => groupCollections(items), [items]);
  const byTask = useMemo(
    () => linkDispatchRunsToTasks(dispatchRuns ?? [], collections).byTask,
    [dispatchRuns, collections]
  );
  // Every board the tab lists, so a row tells another board's suffixed action
  // from a generic one.
  const boardIds = useMemo(() => collections.map((collection) => collection.id), [collections]);

  // Open rows, keyed by board and task. Held above the rows so a streamed
  // change, which re-renders every row, never closes one. The panel mounts
  // this view under its workspace key, so another session or flow starts with
  // every row closed even where its board and task ids repeat.
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(() => new Set());
  const toggleRow = useCallback((key: string) => {
    setOpenRows((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  if (collections.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList className="h-8 w-8" aria-hidden />}
        message="No task collections in this session yet. Run a flow that uses taskBoard or another TaskCollection consumer."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 px-[18px] pt-4 pb-5">
      {collections.map((collection) => (
        <CollectionCard
          key={collection.id}
          collection={collection}
          byTask={byTask}
          truncation={truncation}
          onOpenDispatchRun={onOpenDispatchRun}
          openRows={openRows}
          onToggleRow={toggleRow}
          rowActions={rowActions}
          boardIds={boardIds}
        />
      ))}
    </div>
  );
}

function CollectionCard({
  collection,
  byTask,
  truncation,
  onOpenDispatchRun,
  openRows,
  onToggleRow,
  rowActions,
  boardIds,
}: {
  collection: CollectionView;
  byTask: ReadonlyMap<string, ChildSessionSummary>;
  truncation: Truncation;
  onOpenDispatchRun: (dispatchRun: ChildSessionSummary) => void;
  openRows: ReadonlySet<string>;
  onToggleRow: (key: string) => void;
  rowActions?: RowActions;
  boardIds: readonly string[];
}) {
  // Once per board, not per row.
  const actionNames = useMemo(
    () =>
      rowActions === undefined
        ? undefined
        : taskActionsFor(rowActions.names, rowActions.schemas, collection.id, boardIds),
    [rowActions?.names, rowActions?.schemas, collection.id, boardIds]
  );
  const counts = collection.boardMeta.counts;
  const total = counts?.total ?? collection.tasks.length;
  // THE PREDICATE IS THE PRESENCE OF THE FIELD, and status is out of it
  // entirely. A failed attempt heading for a retry writes `feedback` and
  // leaves it on a row that has gone back to `pending`, so keying this on a
  // status would suppress a true explanation of what the reader is looking at.
  //
  // Presence, not truthiness: a stored empty or whitespace note is a note
  // something wrote, and this panel reports what is stored rather than
  // deciding which stored values are worth a reader's attention.
  //
  // Per board, so a board where nothing carries a note grows no reason slot —
  // nothing apologising for itself on every row.
  const showReason = collection.tasks.some(
    (entry) => entry.task.feedback !== undefined || waitPrompt(entry.task) !== undefined
  );

  const columns = rowColumns(showReason);

  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-collection-id={collection.id}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-0 truncate font-fs-mono text-[13px] font-semibold text-fs-ink">
          {collection.id}
        </span>
        {collection.boardMeta.status && (
          <BoardStatusBadge status={collection.boardMeta.status} />
        )}
        <span className="font-fs-mono text-[10.5px] text-fs-ink3">
          {collection.tasks.length} task
          {collection.tasks.length === 1 ? "" : "s"}
          {total !== collection.tasks.length && ` · meta total ${total}`}
        </span>
        {counts && <CountsRibbon counts={counts} />}
      </div>

      <div className="@container/board min-w-0 border border-fs-ink/30 bg-fs-card">
        {collection.tasks.length === 0 ? (
          <p className="px-3 py-3 font-fs-mono text-[11.5px] text-fs-ink4">
            Board meta only — no task-change items yet.
          </p>
        ) : (
          <>
            <ColumnHeaders columns={columns} showReason={showReason} />
            <ul className="min-w-0 text-xs">
              {collection.tasks.map((entry) => {
                const key = rowKey(collection.id, entry.task.id);
                return (
                  <RowBoundary key={entry.task.id} taskId={entry.task.id} resetOn={entry.task}>
                    <TaskRow
                      entry={entry}
                      open={openRows.has(key)}
                      onToggle={() => onToggleRow(key)}
                      showReason={showReason}
                      dispatchRun={byTask.get(taskLinkKey(collection.id, entry.task.id))}
                      truncation={truncation}
                      onOpenDispatchRun={onOpenDispatchRun}
                      actions={
                        rowActions === undefined || actionNames === undefined
                          ? undefined
                          : (taskId) => (
                              <TaskRowActions
                                taskId={taskId}
                                actions={actionNames}
                                schemas={rowActions.schemas}
                                run={rowActions.run}
                                requests={rowActions.requests}
                              />
                            )
                      }
                    />
                  </RowBoundary>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The collapsed row's grid classes. Status leads; goal and reason share what is
 * left, each allowed to shrink to nothing (`minmax(0, 1fr)`) so neither pushes
 * the row past the pane. The fixed tracks are what let the column headers line
 * up with every row on the board.
 *
 * Under 40rem of board (the center pane of a 1280px window) the fixed tracks
 * alone would take the whole row, so the Change column is dropped there (the
 * open row still shows it) and the run slot narrows, leaving the space to goal
 * and reason. Literal strings so Tailwind can see them.
 */
function rowColumns(showReason: boolean): string {
  return showReason
    ? "grid-cols-[7.5rem_minmax(0,1fr)_minmax(0,1fr)_6rem] @[40rem]/board:grid-cols-[7.5rem_minmax(0,1fr)_minmax(0,1fr)_6rem_7rem]"
    : "grid-cols-[7.5rem_minmax(0,1fr)_6rem] @[40rem]/board:grid-cols-[7.5rem_minmax(0,1fr)_6rem_7rem]";
}

/** The Change slot, shown only on a board wide enough for it. */
const CHANGE_SLOT = "hidden @[40rem]/board:block";

/** The run slot's width, shared by the header and every row. */
const RUN_SLOT = "w-12 shrink-0 text-right @[40rem]/board:w-24";

/** Mono uppercase headers over the rows, on the rows' own grid. */
function ColumnHeaders({ columns, showReason }: { columns: string; showReason: boolean }) {
  return (
    <div
      aria-hidden
      className="flex min-w-0 items-center gap-2 border-b border-fs-ink/20 pr-3 font-fs-mono text-[10px] font-medium uppercase tracking-[.12em] text-fs-ink4"
    >
      <div className={`grid min-w-0 flex-1 items-center gap-2 py-[7px] pl-3 ${columns}`}>
        <span className="min-w-0 truncate">Status</span>
        <span className="min-w-0 truncate">Goal</span>
        {showReason && <span className="min-w-0 truncate">Reason</span>}
        <span className="min-w-0 truncate">Assignee</span>
        <span className={`min-w-0 truncate ${CHANGE_SLOT}`}>Change</span>
      </div>
      <span className={RUN_SLOT}>Run</span>
    </div>
  );
}

/** One key per row across boards: two boards may both hold a task id. */
function rowKey(collectionId: string, taskId: string): string {
  return `${collectionId}\u0000${taskId}`;
}

function TaskRow({
  entry,
  open,
  onToggle,
  showReason,
  dispatchRun,
  truncation,
  onOpenDispatchRun,
  actions,
}: {
  entry: ResolvedTask;
  open: boolean;
  onToggle: () => void;
  /** Decided by the board, so every row on one board has the same slots. */
  showReason: boolean;
  dispatchRun?: ChildSessionSummary;
  truncation: Truncation;
  onOpenDispatchRun: (dispatchRun: ChildSessionSummary) => void;
  /** The Actions strip for this row's task, when the panel supplies actions. */
  actions?: (taskId: string) => ReactNode;
}) {
  const { task } = entry;
  const bodyId = useId();
  const columns = rowColumns(showReason);
  const runLink = (
    <DispatchRunLink dispatchRun={dispatchRun} truncation={truncation} onOpen={onOpenDispatchRun} />
  );
  return (
    <li className="min-w-0 border-b border-fs-ink/12 last:border-b-0" data-task-id={task.id}>
      <div
        className={`flex min-w-0 items-center gap-2 pr-3 ${
          open ? "bg-fs-blue/8 shadow-[inset_2px_0_0_var(--fs-blue)]" : "hover:bg-fs-ink/5"
        }`}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          data-row-grid
          className={`grid min-w-0 flex-1 items-center gap-2 py-[9px] pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fs-blue/40 ${columns}`}
        >
          <span data-slot="status" className="inline-flex min-w-0 items-center gap-1">
            <ChevronRight
              className={`h-3 w-3 shrink-0 text-fs-ink4 transition-transform ${open ? "rotate-90" : ""}`}
              aria-hidden
            />
            <StatusPill status={task.status} />
          </span>
          {/* `title ?? goal`, the substrate's plan-UI contract: a verbose
              goal stays in the open row, and the list stays scannable. */}
          <span data-slot="goal" className="min-w-0 truncate text-[13.5px] text-fs-ink" title={task.title ?? task.goal}>
            {task.title ?? task.goal}
          </span>
          {showReason && (
            // Rendered exactly as the row carries it — not trimmed, not
            // normalized. This panel's job is to report what is stored, and a
            // stored note of spaces is a fact about the row worth seeing.
            // Clamped to one line; the whole string is on the title and in
            // the open row.
            <span data-slot="reason" className="min-w-0 truncate text-[13px] text-fs-ink2" title={waitPrompt(task) ?? task.feedback}>
              {waitPrompt(task) ?? task.feedback ?? <span className="text-fs-ink5">—</span>}
            </span>
          )}
          <span data-slot="assignee" className="min-w-0 truncate font-fs-mono text-[11.5px] text-fs-ink2" title={task.assignee}>
            {task.assignee ?? "—"}
          </span>
          <span data-slot="kind" className={`min-w-0 truncate whitespace-nowrap font-fs-mono text-[11px] text-fs-ink3 ${CHANGE_SLOT}`}>
            <span>{entry.kind ?? "—"}</span>
            {entry.changeCount > 1 && (
              <span className="ml-1 border border-fs-ink/30 px-1 text-[10px] text-fs-ink4">
                ×{entry.changeCount}
              </span>
            )}
          </span>
        </button>
        {/* Outside the toggle: a button cannot hold another button. */}
        <span data-slot="run" className={RUN_SLOT}>
          {runLink}
        </span>
      </div>
      {open && (
        <TaskRowBody entry={entry} id={bodyId}>
          {actions?.(task.id)}
        </TaskRowBody>
      )}
    </li>
  );
}

/**
 * The dispatch run running this task, if one is.
 *
 * Renders `—` rather than nothing when there is none, which is the majority
 * case: an inline worker runs inside the request you are already looking at, so
 * "no dispatch run" is the normal answer and not a gap in the data.
 */
function DispatchRunLink({
  dispatchRun,
  truncation,
  onOpen,
}: {
  dispatchRun?: ChildSessionSummary;
  truncation: Truncation;
  onOpen: (dispatchRun: ChildSessionSummary) => void;
}) {
  if (dispatchRun === undefined) {
    // "No dispatch run" is only a fact when the whole listing was read. Past that
    // page, or when the check for more failed, the honest statement is "none
    // among the ones I have" — and a bare dash makes the stronger claim.
    //
    // The two uncertain cases are kept apart because they lead somewhere
    // different: `more` means the match may be on a page this panel does not
    // read, so refreshing will not change it; `unknown` means the check itself
    // failed, so refreshing might.
    if (truncation === "more") {
      return (
        <span
          className="font-fs-mono text-[11px] text-fs-ink3"
          title="No dispatch run among those listed. This session has more background work than the panel reads, so an older one may be running this task."
        >
          —?
        </span>
      );
    }
    if (truncation === "unknown") {
      return (
        <span
          className="font-fs-mono text-[11px] text-fs-ink3"
          title="No dispatch run among those listed, and checking whether there are more didn't come back — so one may be missing from the list."
        >
          —?
        </span>
      );
    }
    return <span className="font-fs-mono text-[11px] text-fs-ink5">—</span>;
  }

  // The entry the run runs (`implement`, from a `task:implement` coordinate).
  // A linked run's key names this very row or its worker, so repeating it here
  // says nothing the row does not; the entry is the part that is new. The id
  // stands in when no entry was stamped.
  const label = decodeDispatchRunEntry(dispatchRun.coordinate)?.action ?? dispatchRun.id;
  // A match is page-local. `linkDispatchRunsToTasks` establishes that the
  // pairing is unambiguous IN THE LOADED PAGE; an older unlisted dispatch run
  // whose key names the same task id or worker would fit too, and it would belong
  // to a different board — the FIX-1088 class, where task events carry no board
  // identity to settle it.
  //
  // Marked rather than withheld. The link is a documented best-effort
  // navigation affordance, so a probably-right destination flagged as unchecked
  // beats no destination at all; withholding would delete the feature on any
  // session large enough to page.
  const unverified = truncation !== "complete";
  return (
    <button
      type="button"
      onClick={() => onOpen(dispatchRun)}
      title={
        unverified
          ? `Open dispatch run ${dispatchRun.id}. Matched against the dispatch runs listed; others were not read, so this may not be the one running the task.`
          : `Open dispatch run ${dispatchRun.id}`
      }
      className={`inline-flex max-w-full items-center gap-1 border px-1.5 py-0.5 font-fs-mono text-[10px] outline-none hover:border-fs-ink hover:text-fs-ink focus-visible:ring-2 focus-visible:ring-fs-blue/40 ${
        unverified ? "border-dashed border-fs-ink3 text-fs-ink2" : "border-fs-ink/30 text-fs-blue"
      }`}
    >
      <Layers className="h-3 w-3" aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
      {unverified && <span aria-hidden>?</span>}
    </button>
  );
}

/** A 7px square: the brand's status glyph. */
function Glyph({ tone }: { tone: string }) {
  return <span aria-hidden className={`inline-block size-[7px] shrink-0 ${tone}`} />;
}

function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? FALLBACK_TONE;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 font-fs-mono text-[11px] font-medium ${tone.text}`}>
      <Glyph tone={tone.glyph} />
      <span className="truncate">{status}</span>
    </span>
  );
}

type Tone = { glyph: string; text: string };

const FALLBACK_TONE: Tone = { glyph: "border border-dashed border-fs-ink3", text: "text-fs-ink3" };

/**
 * By meaning: running is blueprint, done is green, failed is red, not yet
 * started is a dashed outline. Held and cancelled are notes, not
 * problems, so they stay in ink.
 */
const STATUS_TONE: Record<string, Tone> = {
  pending: FALLBACK_TONE,
  in_progress: { glyph: "bg-fs-blue", text: "text-fs-blue" },
  held: { glyph: "border border-fs-ink2", text: "text-fs-ink2" },
  completed: { glyph: "bg-fs-green", text: "text-fs-green" },
  errored: { glyph: "bg-fs-red", text: "text-fs-red" },
  cancelled: { glyph: "border border-fs-ink4", text: "text-fs-ink4" },
};

function BoardStatusBadge({ status }: { status: string }) {
  return (
    <span className="border border-fs-ink/45 px-1 font-fs-mono text-[9.5px] uppercase tracking-[.08em] text-fs-ink3">
      {status}
    </span>
  );
}

function CountsRibbon({ counts }: { counts: NonNullable<BoardMeta["counts"]> }) {
  const ribbon: Array<[string, number, string]> = [
    ["pending", counts.pending, STATUS_TONE.pending!.glyph],
    ["active", counts.in_progress, STATUS_TONE.in_progress!.glyph],
    ["held", counts.held, STATUS_TONE.held!.glyph],
    ["done", counts.completed, STATUS_TONE.completed!.glyph],
    ["error", counts.errored, STATUS_TONE.errored!.glyph],
    ["canc", counts.cancelled, STATUS_TONE.cancelled!.glyph],
  ];
  return (
    <div className="ml-auto flex shrink-0 flex-wrap items-center gap-x-3.5 gap-y-1 font-fs-mono text-[11px] tabular-nums text-fs-ink3">
      {ribbon.map(([label, value, glyph]) =>
        value > 0 ? (
          <span key={label} className="inline-flex items-center gap-1.5">
            <Glyph tone={glyph} />
            {label} {value}
          </span>
        ) : null,
      )}
    </div>
  );
}

/**
 * One row's render failure stays in that row. A task the view cannot draw (a
 * field of a shape it does not expect) shows a one-line note in its place, and
 * every other row on the board still renders. Retried when the task changes.
 */
class RowBoundary extends Component<
  { taskId: string; resetOn: unknown; children: ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidUpdate(previous: { resetOn: unknown }) {
    if (this.state.error !== null && previous.resetOn !== this.props.resetOn) this.setState({ error: null });
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <li className="min-w-0 border-b border-fs-ink/12 px-3 py-1.5 text-fs-red" data-task-id={this.props.taskId}>
        <span className="font-fs-mono">{this.props.taskId}</span> could not be drawn: {this.state.error}
      </li>
    );
  }
}
