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
 * A task whose seat hands its rows off to a `task` entry is run by a dispatch run
 * rather than by the request you are looking at, so its row carries a link into that
 * dispatch run (FIX-1071). The link is derived, absent for most tasks, and never
 * something the row is gated on — see `lib/dispatch-run-links`.
 *
 * A task also carries a short note about itself on `feedback`, and the row's
 * reason slot renders it so a parked row says why without being opened
 * (FIX-1481). The slot is keyed on the field being present, never on the
 * `parked` status, and the note is rendered exactly as stored — see
 * `showReason` in `CollectionCard` for why both of those are load-bearing.
 *
 * Each task is one row that opens in place, like an accordion (FIX-1629). The
 * collapsed row leads with status, then goal and reason sharing the width, so
 * the reason is in view on a laptop-width pane; the open row is
 * `task-row-body`. Open rows are held here, keyed by board and task id, so a
 * streamed change re-renders a row without closing it.
 */
import { Component, useCallback, useMemo, useState, type ReactNode } from "react";
import type { ActionInputSchema, ChildSessionSummary } from "@flow-state-dev/client";
import { ChevronRight, ClipboardList, Layers } from "lucide-react";
import {
  groupCollections,
  type BoardMeta,
  type CollectionView,
  type ResolvedTask,
  type TaskStreamItem,
} from "../../lib/task-collection-state";
import {
  decodeDispatchRunEntry,
  linkDispatchRunsToTasks,
  taskLinkKey,
} from "../../lib/dispatch-run-links";
import type { Truncation } from "../../hooks/use-dispatch-runs";
import { EmptyState } from "../shared/empty-state";
import { Badge } from "../ui/badge";
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
  // change, which re-renders every row, never closes one.
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
    <div className="flex flex-col gap-3 p-3">
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
  // entirely. Three verbs write `feedback` — parking for review, a failed
  // attempt heading for a retry, and resuming — and the retry one leaves it on
  // a row that has gone back to `pending`, so keying this on `parked` would
  // suppress a true explanation of what the reader is looking at.
  //
  // Presence, not truthiness: a stored empty or whitespace note is a note
  // something wrote, and this panel reports what is stored rather than
  // deciding which stored values are worth a reader's attention.
  //
  // Per board, so a board where nothing carries a note grows no reason slot —
  // nothing apologising for itself on every row.
  const showReason = collection.tasks.some(
    (entry) => entry.task.feedback !== undefined
  );

  return (
    <div
      className="min-w-0 rounded-md border border-slate-800 bg-slate-900/40"
      data-collection-id={collection.id}
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-3 py-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-1.5">
            <ClipboardList className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
            <span className="font-mono text-xs text-slate-200 truncate">
              {collection.id}
            </span>
            {collection.boardMeta.status && (
              <BoardStatusBadge status={collection.boardMeta.status} />
            )}
          </div>
          <span className="text-[10px] text-slate-500">
            {collection.tasks.length} task
            {collection.tasks.length === 1 ? "" : "s"}
            {total !== collection.tasks.length && ` · meta total ${total}`}
          </span>
        </div>
        {counts && <CountsRibbon counts={counts} />}
      </div>

      {collection.tasks.length === 0 ? (
        <p className="px-3 py-3 text-xs italic text-slate-500">
          Board meta only — no task-change items yet.
        </p>
      ) : (
        <ul className="min-w-0 text-xs">
          {collection.tasks.map((entry) => {
            const key = rowKey(collection.id, entry.task.id);
            return (
              <RowBoundary key={entry.task.id} taskId={entry.task.id} resetOn={entry.task}>
                <TaskRow
                  entry={entry}
                  rowId={key}
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
      )}
    </div>
  );
}

/** One key per row across boards: two boards may both hold a task id. */
function rowKey(collectionId: string, taskId: string): string {
  return `${collectionId}\u0000${taskId}`;
}

/** A DOM id for the row's body, safe whatever the ids contain. */
function bodyIdOf(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return `task-row-${(hash >>> 0).toString(36)}-${key.length}`;
}

function TaskRow({
  entry,
  rowId,
  open,
  onToggle,
  showReason,
  dispatchRun,
  truncation,
  onOpenDispatchRun,
  actions,
}: {
  entry: ResolvedTask;
  rowId: string;
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
  const bodyId = bodyIdOf(rowId);
  // Status leads; goal and reason share what is left, each allowed to shrink
  // to nothing (`minmax(0, 1fr)`) so neither pushes the row past the pane.
  const columns = showReason
    ? "auto minmax(0, 1fr) minmax(0, 1fr) auto auto"
    : "auto minmax(0, 1fr) auto auto";
  const runLink = (
    <DispatchRunLink dispatchRun={dispatchRun} truncation={truncation} onOpen={onOpenDispatchRun} />
  );
  return (
    <li className="min-w-0 border-b border-slate-800/50" data-task-id={task.id}>
      <div className="flex min-w-0 items-center gap-2 pr-3 hover:bg-slate-900/40">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          data-row-grid
          className="grid min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-left"
          style={{ gridTemplateColumns: columns }}
        >
          <span data-slot="status" className="inline-flex items-center gap-1">
            <ChevronRight
              className={`h-3 w-3 shrink-0 text-slate-500 transition-transform ${open ? "rotate-90" : ""}`}
              aria-hidden
            />
            <StatusPill status={task.status} />
          </span>
          <span data-slot="goal" className="min-w-0 truncate text-slate-200" title={task.goal}>
            {task.goal}
          </span>
          {showReason && (
            // Rendered exactly as the row carries it — not trimmed, not
            // normalized. This panel's job is to report what is stored, and a
            // stored note of spaces is a fact about the row worth seeing.
            // Clamped to one line; the whole string is on the title and in
            // the open row.
            <span data-slot="reason" className="min-w-0 truncate text-slate-300" title={task.feedback}>
              {task.feedback ?? <span className="text-slate-600">—</span>}
            </span>
          )}
          <span data-slot="assignee" className="max-w-[10rem] truncate text-slate-400" title={task.assignee}>
            {task.assignee ?? "—"}
          </span>
          <span data-slot="kind" className="whitespace-nowrap text-slate-400">
            <span className="font-mono text-[10px]">{entry.kind ?? "—"}</span>
            {entry.changeCount > 1 && (
              <span className="ml-1 rounded bg-slate-800 px-1 text-[10px] text-slate-400">
                ×{entry.changeCount}
              </span>
            )}
          </span>
        </button>
        {/* Outside the toggle: a button cannot hold another button. */}
        <span data-slot="run" className="shrink-0">
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
          className="text-amber-500/70"
          title="No dispatch run among those listed. This session has more background work than the panel reads, so an older one may be running this task."
        >
          —?
        </span>
      );
    }
    if (truncation === "unknown") {
      return (
        <span
          className="text-amber-500/70"
          title="No dispatch run among those listed, and checking whether there are more didn't come back — so one may be missing from the list."
        >
          —?
        </span>
      );
    }
    return <span className="text-slate-600">—</span>;
  }

  // The entry the run runs (`implement`, from a `task:implement` coordinate).
  // A linked run's key names this very row or its seat, so repeating it here
  // says nothing the row does not; the entry is the part that is new. The id
  // stands in when no entry was stamped.
  const label = decodeDispatchRunEntry(dispatchRun.coordinate)?.action ?? dispatchRun.id;
  // A match is page-local. `linkDispatchRunsToTasks` establishes that the
  // pairing is unambiguous IN THE LOADED PAGE; an older unlisted dispatch run
  // whose key names the same task id or seat would fit too, and it would belong
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
      className={`inline-flex items-center gap-1 rounded border bg-slate-900/60 px-1.5 py-0.5 text-[10px] hover:bg-slate-800 ${
        unverified
          ? "border-amber-500/40 text-amber-200/90 hover:border-amber-500/60"
          : "border-slate-800 text-sky-300 hover:border-slate-700"
      }`}
    >
      <Layers className="h-3 w-3" aria-hidden />
      <span className="max-w-[10rem] truncate">{label}</span>
      {unverified && <span aria-hidden>?</span>}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "bg-slate-800 text-slate-400";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] ${tone}`}
    >
      {status}
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  pending: "bg-slate-800 text-slate-400",
  in_progress: "bg-blue-900/40 text-blue-300",
  blocked: "bg-amber-900/40 text-amber-300",
  parked: "bg-cyan-900/40 text-cyan-300",
  completed: "bg-emerald-900/40 text-emerald-300",
  errored: "bg-red-900/40 text-red-300",
  cancelled: "bg-slate-800/60 text-slate-500",
};

function BoardStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="secondary" className="text-[10px]">
      {status}
    </Badge>
  );
}

function CountsRibbon({ counts }: { counts: NonNullable<BoardMeta["counts"]> }) {
  const ribbon: Array<[string, number, string]> = [
    ["pending", counts.pending, "text-slate-400"],
    ["active", counts.in_progress, "text-blue-300"],
    ["blocked", counts.blocked, "text-amber-300"],
    ["parked", counts.parked, "text-cyan-300"],
    ["done", counts.completed, "text-emerald-300"],
    ["error", counts.errored, "text-red-300"],
    ["canc", counts.cancelled, "text-slate-500"],
  ];
  return (
    <div className="flex shrink-0 items-center gap-2 text-[10px] tabular-nums">
      {ribbon.map(([label, value, tone]) =>
        value > 0 ? (
          <span key={label} className={tone}>
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
      <li className="min-w-0 border-b border-slate-800/50 px-3 py-1.5 text-red-300" data-task-id={this.props.taskId}>
        <span className="font-mono">{this.props.taskId}</span> could not be drawn: {this.state.error}
      </li>
    );
  }
}
