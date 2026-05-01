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
 */
import { useMemo } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { ClipboardList, Eye } from "lucide-react";
import {
  TASK_BOARD_META_COMPONENT,
  TASK_CHANGE_COMPONENT,
  type BoardMeta,
  type Task,
  type TaskChangeKind,
  type TaskStatus,
} from "../../lib/task-collection-state";
import { EmptyState } from "../shared/empty-state";
import { Badge } from "../ui/badge";
import { JsonViewer } from "../shared/json-viewer";

type CollectionView = {
  id: string;
  boardMeta: BoardMeta;
  /** Latest task entry per id, sorted by createdAt asc. */
  tasks: ResolvedTask[];
};

type ResolvedTask = {
  task: Task;
  kind?: TaskChangeKind;
  prevStatus?: TaskStatus;
  /** Number of `task-change` items observed for this task. */
  changeCount: number;
};

type Props = {
  /** Flat list of items the user is currently inspecting (across all requests). */
  items: ReadonlyArray<OutputItem>;
};

export function TaskCollectionsView({ items }: Props) {
  const collections = useMemo(() => groupCollections(items), [items]);

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
        <CollectionCard key={collection.id} collection={collection} />
      ))}
    </div>
  );
}

function CollectionCard({ collection }: { collection: CollectionView }) {
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
              <th className="py-1.5 font-medium">Latest kind</th>
              <th className="px-3 py-1.5 font-medium text-right">Details</th>
            </tr>
          </thead>
          <tbody>
            {collection.tasks.map((entry) => (
              <TaskRow key={entry.task.id} entry={entry} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TaskRow({ entry }: { entry: ResolvedTask }) {
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

// ---------------------------------------------------------------------------
// Item-stream → CollectionView
// ---------------------------------------------------------------------------

type TaskChangeData = {
  collectionId?: string;
  taskId?: string;
  kind?: TaskChangeKind;
  task?: Task;
  prevStatus?: TaskStatus;
};

type TaskBoardMetaData = {
  collectionId?: string;
  status?: string;
  counts?: BoardMeta["counts"];
};

function groupCollections(items: ReadonlyArray<OutputItem>): CollectionView[] {
  const byId = new Map<
    string,
    {
      id: string;
      boardMeta: BoardMeta;
      tasksById: Map<string, ResolvedTask>;
    }
  >();

  // Forward iteration so `tasksById` ends with the latest entry per task and
  // `boardMeta` reflects the latest meta. Forward also lets us track the
  // total number of changes per task (for the `×N` ribbon).
  for (const item of items) {
    if (item.type !== "component") continue;
    const component = (item as { component?: string }).component;
    const data = (item as { data?: unknown }).data;

    if (component === TASK_CHANGE_COMPONENT) {
      const change = data as TaskChangeData;
      if (
        typeof change.collectionId !== "string" ||
        typeof change.taskId !== "string" ||
        change.task === undefined
      ) {
        continue;
      }
      const bucket = ensureBucket(byId, change.collectionId);
      const prior = bucket.tasksById.get(change.taskId);
      bucket.tasksById.set(change.taskId, {
        task: change.task,
        kind: change.kind,
        prevStatus: change.prevStatus,
        changeCount: (prior?.changeCount ?? 0) + 1,
      });
      continue;
    }

    if (component === TASK_BOARD_META_COMPONENT) {
      const meta = data as TaskBoardMetaData;
      if (typeof meta.collectionId !== "string") continue;
      const bucket = ensureBucket(byId, meta.collectionId);
      bucket.boardMeta = {
        status: meta.status,
        counts: meta.counts,
      };
    }
  }

  const result: CollectionView[] = [];
  for (const { id, boardMeta, tasksById } of byId.values()) {
    const tasks = [...tasksById.values()].sort((a, b) => {
      const at = a.task.createdAt ?? 0;
      const bt = b.task.createdAt ?? 0;
      if (at !== bt) return at - bt;
      return a.task.id.localeCompare(b.task.id);
    });
    result.push({ id, boardMeta, tasks });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

function ensureBucket(
  map: Map<
    string,
    {
      id: string;
      boardMeta: BoardMeta;
      tasksById: Map<string, ResolvedTask>;
    }
  >,
  id: string,
) {
  let bucket = map.get(id);
  if (bucket === undefined) {
    bucket = {
      id,
      boardMeta: {},
      tasksById: new Map(),
    };
    map.set(id, bucket);
  }
  return bucket;
}
