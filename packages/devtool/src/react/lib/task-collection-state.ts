/**
 * Local mirror of the unified Plan/Task substrate's component-item types
 * (FIX-444 / FIX-446) for the DevTool TaskCollections panel (FIX-445), plus
 * the derivation that folds a session's item stream back into boards.
 *
 * Inlined rather than imported from `@flow-state-dev/orchestration` to keep the
 * DevTool app dep surface narrow — the panel only needs the wire shape, not
 * the runtime mutation API. Update in lockstep with
 * `packages/tasks/src/schema/task.ts` and the substrate emission sites in
 * `packages/tasks/src/collection/get-or-create.ts` and
 * `packages/patterns/src/task-board/blocks/board-meta.ts`.
 *
 * {@link groupCollections} lived in `components/workspace/task-collections-view`
 * until the Workstreams panel needed the same boards (FIX-1071). It is a pure
 * fold over items with no rendering in it, so it belongs beside the wire shapes
 * it produces rather than inside one of its two consumers.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { DevtoolItem } from "./item-types";

/** Component-item type emitted on every per-task lifecycle event. */
export const TASK_CHANGE_COMPONENT = "task-change";

/** Component-item type emitted at board start / end. */
export const TASK_BOARD_META_COMPONENT = "task-board-meta";

/**
 * Canonical task status set from the substrate. Open-ended at the consumer
 * boundary — pattern wrappers may extend the status vocabulary.
 */
export type TaskStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "awaiting_review"
  | "completed"
  | "errored"
  | "cancelled"
  | (string & {});

/** Mirror of the lifecycle transition kinds the substrate publishes. */
export type TaskChangeKind =
  | "added"
  | "claimed"
  | "completed"
  | "errored"
  | "retried"
  | "blocked"
  | "unblocked"
  | "review_requested"
  | "resumed"
  | "cancelled"
  | "label_changed"
  | "metadata_changed"
  | "priority_changed"
  | "assignee_changed"
  | (string & {});

/** Mirror of `Task` from `@flow-state-dev/orchestration`. Wire-shape only. */
export type Task = {
  id: string;
  goal: string;
  status: TaskStatus;
  attempts?: number;
  maxAttempts?: number;
  assignee?: string;
  deps?: string[];
  priority?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  feedback?: string;
  labels?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
  startedAt?: number;
  completedAt?: number;
};

/** Counts payload on `task-board-meta` completion. */
export type BoardCounts = {
  total: number;
  pending: number;
  in_progress: number;
  blocked: number;
  awaiting_review: number;
  completed: number;
  errored: number;
  cancelled: number;
};

export type BoardMeta = {
  status?: string;
  counts?: BoardCounts;
};

// ---------------------------------------------------------------------------
// Item-stream → CollectionView
// ---------------------------------------------------------------------------

/** One board, as reconstructed from the items a session emitted. */
export type CollectionView = {
  id: string;
  boardMeta: BoardMeta;
  /** Latest task entry per id, sorted by createdAt asc. */
  tasks: ResolvedTask[];
};

/** A task at its latest observed state, with how it got there. */
export type ResolvedTask = {
  task: Task;
  kind?: TaskChangeKind;
  prevStatus?: TaskStatus;
  /** Number of `task-change` items observed for this task. */
  changeCount: number;
};

/** The item shapes both DevTool panels iterate over. */
export type TaskStreamItem = OutputItem | DevtoolItem;

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

/**
 * Fold a session's items into the boards they describe.
 *
 * Auto-discovery is by `data.collectionId` on `task-change` and
 * `task-board-meta` component items — pattern-agnostic, so any consumer of the
 * unified Plan/Task substrate shows up.
 */
/** The part of a request group the task fold needs. */
export type TaskItemSource = {
  /** When the request started — the only cross-request clock available. */
  startedAt: number;
  items: ReadonlyArray<TaskStreamItem>;
};

/**
 * Flatten request groups into the chronological item stream the fold expects.
 *
 * The panel holds requests NEWEST-FIRST (`listSessionRequests` orders
 * `updated_at DESC`) and must keep them that way for the Stream and Trace tabs,
 * so the ordering is corrected here rather than on `requestGroups` itself.
 *
 * Ordering the requests — not the items — is what makes this safe: within a
 * request the items are already in sequence order, and sorting the flat item
 * list would disturb that. After this, walk order agrees with time on BOTH
 * axes, which is what lets {@link groupCollections} settle a tie by walk order.
 */
export function flattenTaskItems(
  groups: readonly TaskItemSource[]
): TaskStreamItem[] {
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => {
      if (a.group.startedAt !== b.group.startedAt) {
        return a.group.startedAt - b.group.startedAt;
      }
      // Equal `startedAt` — two requests that began in the same millisecond. A
      // stable sort would keep the INPUT order here, and the input is
      // newest-first, so the axis would silently re-invert for exactly the
      // tie this ordering exists to fix. Higher original index is the older
      // request, so it goes first.
      return b.index - a.index;
    })
    .flatMap(({ group }) => group.items);
}

/** An item's emission time, or the beginning of time when it carries none. */
function itemTs(item: TaskStreamItem): number {
  return (item as { ts?: number }).ts ?? Number.NEGATIVE_INFINITY;
}

/**
 * Does an arriving item supersede what is currently held for the same key?
 *
 * The fold's one precedence rule, stated once because both things it folds —
 * per-task changes and per-collection board meta — obey it, and stating it
 * twice is how the two came to disagree:
 *
 * 1. **`ts` wins outright.** It is real chronology. Two requests overlap all
 *    the time, and the one that STARTED earlier can emit later — a long drain
 *    finishing after a short one began. That emission genuinely is the newer
 *    fact, whichever request it belongs to.
 * 2. **Request order breaks a `ts` tie**, because the caller flattens
 *    chronologically (`flattenTaskItems`).
 * 3. **Walk order breaks a tie inside one request**, where the sequence is the
 *    order — which is what `>=` preserves here.
 *
 * Nothing held wins by default: the first item for a key always takes.
 */
function supersedes(incomingTs: number, heldTs: number | undefined): boolean {
  return heldTs === undefined || incomingTs >= heldTs;
}

export function groupCollections(
  items: ReadonlyArray<TaskStreamItem>
): CollectionView[] {
  const byId = new Map<
    string,
    {
      id: string;
      boardMeta: BoardMeta;
      tasksById: Map<string, ResolvedTask>;
      /** `ts` of the change currently held per task. Internal to the fold. */
      tsById: Map<string, number>;
      /** `ts` of the board meta currently held. Internal to the fold. */
      metaTs?: number;
    }
  >();

  // One pass, counting every change and keeping the newest of everything —
  // tasks and board meta alike, both through `supersedes`.
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
      const changeCount = (prior?.changeCount ?? 0) + 1;
      // Latest by `supersedes`, not last-walked: the panel receives requests
      // newest-first, so "the last item walked past" was the OLDEST request's
      // snapshot of any task that changed more than once — a stale `status`,
      // `assignee` and `topic` for everything downstream to render and match
      // against.
      const ts = itemTs(item);
      if (prior !== undefined && !supersedes(ts, bucket.tsById.get(change.taskId))) {
        // An older change arriving after a newer one. It still counts as
        // activity — the `×N` ribbon reports how much happened, not who won.
        bucket.tasksById.set(change.taskId, { ...prior, changeCount });
        continue;
      }
      bucket.tsById.set(change.taskId, ts);
      bucket.tasksById.set(change.taskId, {
        task: change.task,
        kind: change.kind,
        prevStatus: change.prevStatus,
        changeCount,
      });
      continue;
    }

    if (component === TASK_BOARD_META_COMPONENT) {
      const meta = data as TaskBoardMetaData;
      if (typeof meta.collectionId !== "string") continue;
      const bucket = ensureBucket(byId, meta.collectionId);
      // Same rule as the task fold. Replacing unconditionally was justified on
      // the two metas ONE board emits being a tie — but two overlapping drains
      // on one collection are not a tie: the earlier-STARTED one can emit its
      // final counts after the later one, so request order walks it first and
      // last-wins then overwrites the newer fact with an older snapshot.
      const ts = itemTs(item);
      if (!supersedes(ts, bucket.metaTs)) continue;
      bucket.metaTs = ts;
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
      /** `ts` of the change currently held per task. Internal to the fold. */
      tsById: Map<string, number>;
      /** `ts` of the board meta currently held. Internal to the fold. */
      metaTs?: number;
    }
  >,
  id: string
) {
  let bucket = map.get(id);
  if (bucket === undefined) {
    bucket = {
      id,
      boardMeta: {},
      tasksById: new Map(),
      tsById: new Map(),
    };
    map.set(id, bucket);
  }
  return bucket;
}
