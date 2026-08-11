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
 * A task whose worker was declared detached is run by a Workstream rather than
 * by the request you are looking at, so its row carries a link into that
 * Workstream (FIX-1071). The link is derived, absent for most tasks, and never
 * something the row is gated on — see `lib/workstream-links`.
 */
import { useMemo } from "react";
import type { WorkstreamSummary } from "@flow-state-dev/client";
import { ClipboardList, Eye, Layers } from "lucide-react";
import {
  groupCollections,
  type BoardMeta,
  type CollectionView,
  type ResolvedTask,
  type TaskStreamItem,
} from "../../lib/task-collection-state";
import { linkWorkstreamsToTasks, taskLinkKey } from "../../lib/workstream-links";
import type { Truncation } from "../../hooks/use-workstreams";
import { EmptyState } from "../shared/empty-state";
import { Badge } from "../ui/badge";
import { JsonViewer } from "../shared/json-viewer";

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
  workstreams?: readonly WorkstreamSummary[];
  /**
   * What is known about Workstreams beyond the page that was read. An
   * unmatched task is only definitely unmatched when this is `complete`.
   */
  truncation: Truncation;
  /** Open the Workstream running a task. */
  onOpenWorkstream: (workstream: WorkstreamSummary) => void;
};

export function TaskCollectionsView({ items, workstreams, truncation, onOpenWorkstream }: Props) {
  const collections = useMemo(() => groupCollections(items), [items]);
  const byTask = useMemo(
    () => linkWorkstreamsToTasks(workstreams ?? [], collections).byTask,
    [workstreams, collections]
  );

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
          onOpenWorkstream={onOpenWorkstream}
        />
      ))}
    </div>
  );
}

function CollectionCard({
  collection,
  byTask,
  truncation,
  onOpenWorkstream,
}: {
  collection: CollectionView;
  byTask: ReadonlyMap<string, WorkstreamSummary>;
  truncation: Truncation;
  onOpenWorkstream: (workstream: WorkstreamSummary) => void;
}) {
  const counts = collection.boardMeta.counts;
  const total = counts?.total ?? collection.tasks.length;

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40">
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
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-1.5 font-medium">Id</th>
              <th className="py-1.5 font-medium">Goal</th>
              <th className="py-1.5 font-medium">Status</th>
              <th className="py-1.5 font-medium">Assignee</th>
              <th className="py-1.5 font-medium">Workstream</th>
              <th className="py-1.5 font-medium">Latest kind</th>
              <th className="px-3 py-1.5 font-medium text-right">Details</th>
            </tr>
          </thead>
          <tbody>
            {collection.tasks.map((entry) => (
              <TaskRow
                key={entry.task.id}
                entry={entry}
                workstream={byTask.get(taskLinkKey(collection.id, entry.task.id))}
                truncation={truncation}
                onOpenWorkstream={onOpenWorkstream}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TaskRow({
  entry,
  workstream,
  truncation,
  onOpenWorkstream,
}: {
  entry: ResolvedTask;
  workstream?: WorkstreamSummary;
  truncation: Truncation;
  onOpenWorkstream: (workstream: WorkstreamSummary) => void;
}) {
  const { task } = entry;
  return (
    <tr className="border-b border-slate-800/50 align-top hover:bg-slate-900/40">
      <td className="px-3 py-1.5 font-mono text-[11px] text-slate-300">
        {task.id}
      </td>
      <td className="py-1.5 pr-2 text-slate-200 max-w-md truncate">
        {task.goal}
      </td>
      <td className="py-1.5 pr-2">
        <StatusPill status={task.status} />
      </td>
      <td className="py-1.5 pr-2 text-slate-400">{task.assignee ?? "—"}</td>
      <td className="py-1.5 pr-2">
        <WorkstreamLink
          workstream={workstream}
          truncation={truncation}
          onOpen={onOpenWorkstream}
        />
      </td>
      <td className="py-1.5 pr-2 text-slate-400">
        <span className="font-mono text-[10px]">
          {entry.kind ?? "—"}
        </span>
        {entry.prevStatus !== undefined && (
          <span className="ml-1 text-[10px] text-slate-600">
            (was {entry.prevStatus})
          </span>
        )}
        {entry.changeCount > 1 && (
          <span className="ml-1 rounded bg-slate-800 px-1 text-[10px] text-slate-400">
            ×{entry.changeCount}
          </span>
        )}
      </td>
      <td className="px-3 py-1.5 text-right">
        <details className="inline-block">
          <summary className="inline-flex cursor-pointer items-center gap-0.5 text-[10px] text-slate-400 hover:text-slate-200">
            <Eye className="h-3 w-3" aria-hidden />
            view
          </summary>
          <div className="mt-2 w-[28rem] max-w-full text-left">
            <JsonViewer data={task} />
          </div>
        </details>
      </td>
    </tr>
  );
}

/**
 * The Workstream running this task, if one is.
 *
 * Renders `—` rather than nothing when there is none, which is the majority
 * case: an inline worker runs inside the request you are already looking at, so
 * "no Workstream" is the normal answer and not a gap in the data.
 */
function WorkstreamLink({
  workstream,
  truncation,
  onOpen,
}: {
  workstream?: WorkstreamSummary;
  truncation: Truncation;
  onOpen: (workstream: WorkstreamSummary) => void;
}) {
  if (workstream === undefined) {
    // "No Workstream" is only a fact when the whole listing was read. Past that
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
          title="No workstream among those listed. This session has more background work than the panel reads, so an older one may be running this task."
        >
          —?
        </span>
      );
    }
    if (truncation === "unknown") {
      return (
        <span
          className="text-amber-500/70"
          title="No workstream among those listed, and checking whether there are more didn't come back — so one may be missing from the list."
        >
          —?
        </span>
      );
    }
    return <span className="text-slate-600">—</span>;
  }

  const label = workstream.topic ?? workstream.id;
  // A match is page-local. `resolveWorkstream` establishes that exactly one
  // candidate IN THE LOADED PAGE fits; an older unlisted Workstream with the
  // same topic and a compatible worker would fit too, and it would belong to a
  // different board — the FIX-1088 class, where task events carry no board
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
      onClick={() => onOpen(workstream)}
      title={
        unverified
          ? `Open workstream ${workstream.id}. Matched against the workstreams listed; others were not read, so this may not be the one running the task.`
          : `Open workstream ${workstream.id}`
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
  awaiting_review: "bg-cyan-900/40 text-cyan-300",
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
    ["review", counts.awaiting_review, "text-cyan-300"],
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
