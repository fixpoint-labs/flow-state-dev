"use client";

/**
 * `<TaskPlan />` — generalized renderer for any TaskCollection (FIX-445).
 *
 * Subscribes to two component item types:
 *   - `task-change` — per-task lifecycle, latest-wins per `${collectionId}/${taskId}`.
 *   - `task-board-meta` — board-level aggregate state, latest-wins per `${collectionId}`.
 *
 * Section-grouped lists are the framework default (one section per status). A
 * board-style horizontal layout is a per-app concern — implement it as a
 * `<TaskCollection />` consumer of the same item streams rather than forking
 * this renderer.
 *
 * The legacy `<Plan />` component (plan-meta / plan-task shape) has been
 * retired. Plan & Execute and Supervisor now emit `task-change` and
 * `task-board-meta` items consumed by this component.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { BlockOutputItem, OutputItem } from "@flow-state-dev/core/items";
import {
  ItemRenderer,
  buildItemRenderStream,
  type ItemRenderSegment,
} from "@flow-state-dev/react";
import { ToolGroup } from "./tool";
import { cn } from "@/lib/utils";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  CircleSlashIcon,
  EyeIcon,
  HelpCircleIcon,
  Loader2Icon,
  PauseCircleIcon,
  RotateCcwIcon,
  XCircleIcon,
} from "lucide-react";
import { useSessionItems } from "./session-items-context";
import {
  DEFAULT_HIDDEN_STATUSES,
  TaskEntry,
  TaskStatus,
  StatusGroup,
  Task,
  extractTaskItemWindows,
  extractTaskPlanState,
  groupTasksByAssignee,
  groupTasksByStatus,
  humanizeStatus,
  scopeItemsToLatestCollectionRequest,
} from "./task-plan-state";

// ---------------------------------------------------------------------------
// Status presentation
// ---------------------------------------------------------------------------

export type StatusConfig = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>;
  iconClassName: string;
  goalClassName?: string;
  label?: string;
};

/**
 * Default rendering config for the substrate's seven canonical statuses plus
 * a fallback. Open-ended statuses from pattern wrappers fall through to
 * `unknown` and render as a neutral row rather than throwing.
 */
const DEFAULT_STATUS_CONFIG: Record<string, StatusConfig> = {
  pending: {
    icon: CircleIcon,
    iconClassName: "text-muted-foreground",
    label: "Pending",
  },
  in_progress: {
    icon: Loader2Icon,
    iconClassName: "text-blue-500 animate-spin",
    label: "In progress",
  },
  blocked: {
    icon: PauseCircleIcon,
    iconClassName: "text-amber-500",
    label: "Blocked",
  },
  awaiting_review: {
    icon: EyeIcon,
    iconClassName: "text-cyan-500",
    label: "Awaiting review",
  },
  completed: {
    icon: CheckCircle2Icon,
    iconClassName: "text-green-500",
    goalClassName: "text-muted-foreground line-through",
    label: "Completed",
  },
  errored: {
    icon: XCircleIcon,
    iconClassName: "text-destructive",
    goalClassName: "text-destructive",
    label: "Failed",
  },
  cancelled: {
    icon: CircleSlashIcon,
    iconClassName: "text-muted-foreground",
    goalClassName: "text-muted-foreground line-through",
    label: "Cancelled",
  },
  unknown: {
    icon: HelpCircleIcon,
    iconClassName: "text-muted-foreground",
  },
};

function resolveStatusConfig(
  status: string,
  override?: Record<string, StatusConfig>
): StatusConfig {
  return (
    override?.[status] ??
    DEFAULT_STATUS_CONFIG[status] ??
    DEFAULT_STATUS_CONFIG.unknown!
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type TaskPlanProps = {
  /** Identifier of the TaskCollection this view is bound to. Required. */
  collectionId: string;
  /**
   * Scope the rendered plan to a specific request. The same collection
   * runs once per chat message (request-backed substrate), so the
   * session-level item stream concatenates many runs of the same
   * collection. Without this scope, every TaskPlan instance in the chat
   * history reads from the global stream and shows the latest run's
   * data — including TaskPlans rendered at older positions in the
   * thread. Pass `requestId` to bind the plan to its originating run.
   *
   * When omitted, the component falls back to the most recent request
   * that emitted events for `collectionId` (useful when there's only
   * ever one active board, e.g. embedded views).
   */
  requestId?: string;
  /**
   * Optional explicit items source. When omitted the component reads from
   * `useSessionItems()` context, matching the existing registry components'
   * convention. Pass an array when rendering outside a session context (tests,
   * embedded views, replayed snapshots).
   */
  items?: ReadonlyArray<OutputItem>;
  /**
   * When true, sub-group each status section by `task.assignee`. Sections with
   * a single assignee skip the sub-heading. Missing assignees bucket as
   * "Unassigned" at the end of each section.
   */
  groupByAssignee?: boolean;
  /**
   * Per-app overrides for status rendering. Useful when pattern wrappers
   * extend the status vocabulary (`planning`, `replanning`, `reviewing`).
   * Merges over the built-in canonical set.
   */
  statusConfig?: Record<string, StatusConfig>;
  /**
   * Statuses to hide entirely. Defaults to `["cancelled"]` — most surfaces
   * don't need cancelled tasks in the chat-stream view.
   */
  hiddenStatuses?: ReadonlyArray<TaskStatus>;
  /**
   * Optional title for the board card. When omitted the component shows
   * "Tasks" plus the collection id when distinguishing multiple boards.
   */
  title?: string;
  /**
   * Hide the empty state. By default the card renders a subtle "No tasks
   * yet" line when no `task-change` items exist for the collection. Set this
   * to true when the consumer wants the component to render nothing instead.
   */
  hideEmpty?: boolean;
  className?: string;
};

/**
 * Section-grouped renderer for a TaskCollection. Reads `task-change` and
 * `task-board-meta` component items from the session item stream, latest-wins
 * per task, and groups by status.
 */
export function TaskPlan({
  collectionId,
  requestId,
  items: itemsProp,
  groupByAssignee = false,
  statusConfig,
  hiddenStatuses,
  title,
  hideEmpty,
  className,
}: TaskPlanProps) {
  const sessionItems = useSessionItems();
  const rawItems = itemsProp ?? sessionItems;

  // Scope to one request. When `requestId` is supplied, every TaskPlan
  // mount in the chat history binds to its own run. Otherwise fall back
  // to the latest request that emitted events for the collection.
  const items = useMemo(() => {
    if (requestId !== undefined) {
      return rawItems.filter((item) => item.requestId === requestId);
    }
    return scopeItemsToLatestCollectionRequest(rawItems, collectionId);
  }, [rawItems, collectionId, requestId]);

  const state = useMemo(
    () => extractTaskPlanState(items, collectionId),
    [items, collectionId]
  );

  const taskWindows = useMemo(
    () => extractTaskItemWindows(items, collectionId),
    [items, collectionId]
  );

  const groups = useMemo(
    () => groupTasksByStatus(state.tasks, { hiddenStatuses }),
    [state.tasks, hiddenStatuses]
  );

  const totalVisible = useMemo(
    () => groups.reduce((sum, g) => sum + g.entries.length, 0),
    [groups]
  );

  if (state.tasks.length === 0) {
    if (hideEmpty) return null;
    return (
      <div
        className={cn(
          "not-prose my-2 rounded-md border bg-card p-3 text-card-foreground",
          className
        )}
      >
        <TaskPlanHeader
          title={title ?? "Tasks"}
          collectionId={collectionId}
          boardStatus={state.boardMeta.status}
          completed={0}
          total={0}
        />
        <p className="text-xs text-muted-foreground italic">No tasks yet</p>
      </div>
    );
  }

  // Counts derived from board-meta when available (covers cancelled/hidden
  // tasks that might not appear in the visible set), otherwise from the
  // visible groups.
  const completedCount =
    state.boardMeta.counts?.completed ??
    groups.find((g) => g.status === "completed")?.entries.length ??
    0;
  const totalCount = state.boardMeta.counts?.total ?? totalVisible;

  return (
    <div
      className={cn(
        "not-prose my-2 rounded-md border bg-card p-3 text-card-foreground",
        className
      )}
    >
      <TaskPlanHeader
        title={title ?? "Tasks"}
        collectionId={collectionId}
        boardStatus={state.boardMeta.status}
        completed={completedCount}
        total={totalCount}
      />
      <div className="space-y-3">
        {groups.map((group) => (
          <TaskPlanSection
            key={group.status as string}
            group={group}
            groupByAssignee={groupByAssignee}
            statusConfig={statusConfig}
            taskWindows={taskWindows}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function TaskPlanHeader({
  title,
  collectionId,
  boardStatus,
  completed,
  total,
}: {
  title: string;
  collectionId: string;
  boardStatus?: string;
  completed: number;
  total: number;
}) {
  return (
    <div className="mb-2 flex items-start justify-between gap-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium leading-snug">{title}</p>
        {boardStatus !== undefined && boardStatus !== "completed" && (
          <span
            className={cn(
              "text-[10px] font-medium",
              boardStatusToneClass(boardStatus)
            )}
          >
            {humanizeStatus(boardStatus)}…
          </span>
        )}
        <span className="sr-only">{collectionId}</span>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {completed}/{total}
      </span>
    </div>
  );
}

function boardStatusToneClass(status: string): string {
  switch (status) {
    case "active":
      return "text-blue-500";
    case "planning":
    case "replanning":
      return "text-amber-500";
    case "reviewing":
      return "text-cyan-500";
    default:
      return "text-muted-foreground";
  }
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

function TaskPlanSection({
  group,
  groupByAssignee,
  statusConfig,
  taskWindows,
}: {
  group: StatusGroup;
  groupByAssignee: boolean;
  statusConfig?: Record<string, StatusConfig>;
  taskWindows: Map<string, OutputItem[]>;
}) {
  const subgroups = useMemo(
    () => (groupByAssignee ? groupTasksByAssignee(group.entries) : null),
    [groupByAssignee, group.entries]
  );

  // When sub-grouping is on but there's only one assignee bucket, render flat
  // — adding the sub-heading would just be visual noise.
  const showAssigneeHeadings =
    groupByAssignee && subgroups !== null && subgroups.length > 1;

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {group.label}
        </span>
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">
          {group.entries.length}
        </span>
      </div>
      {showAssigneeHeadings && subgroups !== null ? (
        <div className="space-y-2">
          {subgroups.map((sub) => (
            <div key={sub.label}>
              <p
                className={cn(
                  "mb-0.5 pl-0.5 text-[10px] font-medium",
                  sub.assignee === null
                    ? "italic text-muted-foreground/60"
                    : "text-muted-foreground"
                )}
              >
                {sub.label}
              </p>
              <ul className="space-y-1">
                {sub.entries.map((entry) => (
                  <TaskPlanRow
                    key={entry.task.id}
                    entry={entry}
                    statusConfig={statusConfig}
                    windowItems={taskWindows.get(entry.task.id)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="space-y-1">
          {group.entries.map((entry) => (
            <TaskPlanRow
              key={entry.task.id}
              entry={entry}
              statusConfig={statusConfig}
              windowItems={taskWindows.get(entry.task.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-task row
// ---------------------------------------------------------------------------

function TaskPlanRow({
  entry,
  statusConfig,
  windowItems,
}: {
  entry: TaskEntry;
  statusConfig?: Record<string, StatusConfig>;
  windowItems?: OutputItem[];
}) {
  const { task } = entry;
  const config = resolveStatusConfig(task.status, statusConfig);
  const Icon = config.icon;

  const assigneeBadge =
    task.assignee !== undefined ? (
      <span className="ml-1 shrink-0 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground/80">
        {task.assignee}
      </span>
    ) : null;

  const retryBadge =
    entry.kind === "retried" ||
    (typeof task.attempts === "number" && task.attempts > 1) ? (
      <span className="ml-1 inline-flex shrink-0 items-center gap-0.5 text-[10px] text-amber-500">
        <RotateCcwIcon className="h-2.5 w-2.5" aria-hidden="true" />
        {task.attempts ?? 1}
      </span>
    ) : null;

  const showError = task.status === "errored" && task.error !== undefined;
  const showFeedback =
    task.feedback !== undefined &&
    (task.status === "blocked" ||
      task.status === "awaiting_review" ||
      entry.kind === "retried");
  const deps = formatDeps(task);

  const isActive = task.status === "in_progress";
  const hasWindow = (windowItems?.length ?? 0) > 0;

  // Auto-expand while the task is running, auto-collapse on terminal
  // status. The user can still toggle manually in between; the next
  // status transition resets to the new default.
  const [open, setOpen] = useState(isActive);
  const lastStatusRef = useRef(task.status);
  useEffect(() => {
    if (lastStatusRef.current !== task.status) {
      lastStatusRef.current = task.status;
      setOpen(task.status === "in_progress");
    }
  }, [task.status]);

  const goalRow = (
    <div className="flex flex-wrap items-baseline gap-x-1">
      <span className={cn("text-xs leading-snug", config.goalClassName)}>
        {task.goal}
      </span>
      {assigneeBadge}
      {retryBadge}
      {deps !== null && (
        <span className="text-[10px] text-muted-foreground/60">
          ← {deps}
        </span>
      )}
    </div>
  );

  const banners = (
    <>
      {showError && (
        <p className="mt-0.5 text-[11px] leading-snug text-destructive/80">
          {task.error}
        </p>
      )}
      {showFeedback && (
        <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-snug text-amber-500/80">
          {task.feedback}
        </p>
      )}
    </>
  );

  if (!hasWindow) {
    return (
      <li className="flex items-start gap-2">
        <Icon
          className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", config.iconClassName)}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          {goalRow}
          {banners}
        </div>
      </li>
    );
  }

  return (
    <li>
      <details
        open={open}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
        className="group"
      >
        <summary className="flex cursor-pointer list-none items-start gap-2">
          <Icon
            className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", config.iconClassName)}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            {goalRow}
            {banners}
          </div>
          <ChevronRightIcon
            className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-1.5 space-y-1.5 pl-5">
          <TaskWindowItems items={windowItems!} />
        </div>
      </details>
    </li>
  );
}

function formatDeps(task: Task): string | null {
  if (task.deps === undefined || task.deps.length === 0) return null;
  if (task.deps.length === 1) return task.deps[0]!;
  if (task.deps.length <= 3) return task.deps.join(", ");
  return `${task.deps.slice(0, 2).join(", ")}, +${task.deps.length - 2}`;
}

// ---------------------------------------------------------------------------
// Per-task expansion renderer
// ---------------------------------------------------------------------------

/**
 * Renders the items emitted during a task's execution window. Uses
 * `buildItemRenderStream` for the same dedup / sub-agent / tool-grouping
 * passes as the chat-thread `<ItemsRenderer>`, then dispatches each
 * segment with a kitchen-sink twist:
 *
 *   - tool-call groups → `<ToolGroup>` (rollup with expandable details)
 *   - `block_output` items → `<WorkerBlockOutput>` (registry hides them
 *     globally with `block_output: false`; inside a task they're the
 *     worker's actual response and we want to surface them)
 *   - everything else → `<ItemRenderer>` (delegates to the registry)
 */
function TaskWindowItems({ items }: { items: OutputItem[] }) {
  const segments = useMemo<ItemRenderSegment[]>(
    () =>
      buildItemRenderStream(items, undefined, {
        deduplicateByKey: true,
        showSubAgents: true,
        groupToolCalls: true,
      }),
    [items]
  );

  if (segments.length === 0) return null;

  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === "group") {
          return (
            <ToolGroup
              key={`tg-${segment.items[0]?.id ?? i}`}
              items={segment.items}
            />
          );
        }
        const item = segment.item;
        if (item.type === "block_output") {
          return (
            <WorkerBlockOutput key={item.id} item={item as BlockOutputItem} />
          );
        }
        return <ItemRenderer key={item.id} item={item} />;
      })}
    </>
  );
}

/**
 * Renders the inline payload of a worker's `block_output` item.
 *
 * Sub-agent generators in P&E and supervisor produce structured outputs
 * (e.g. `{ summary, success, reason? }` or a plain string). The chat
 * registry hides `block_output` globally so it doesn't clutter the main
 * thread, but inside a task expansion the worker's response IS what the
 * user came to see. This component pulls a sensible text representation
 * out of the structured value and shows it.
 *
 * `output.kind === "ref"` and `"structure"` are skipped — those are
 * pass-through wrappers; the leaf inline value is on a different item
 * already in the same window.
 */
function WorkerBlockOutput({ item }: { item: BlockOutputItem }) {
  const text = useMemo(() => extractWorkerText(item), [item]);
  if (text === null) return null;

  const isStreaming = item.status === "in_progress";

  return (
    <div
      className={cn(
        "whitespace-pre-wrap rounded border-l-2 border-muted-foreground/20 pl-2 text-xs leading-snug",
        isStreaming
          ? "text-foreground/90"
          : "text-muted-foreground"
      )}
    >
      {text}
      {isStreaming && (
        <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500/60" />
      )}
    </div>
  );
}

function extractWorkerText(item: BlockOutputItem): string | null {
  if (item.output.kind !== "inline") return null;
  const value = item.output.value;
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const summary = obj.summary;
    if (typeof summary === "string" && summary.length > 0) {
      const reason =
        obj.success === false && typeof obj.reason === "string"
          ? `\n\nReason: ${obj.reason}`
          : "";
      return summary + reason;
    }
    // Generic structured output — show as JSON so we never silently swallow content.
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return null;
    }
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Re-exports for consumer ergonomics
// ---------------------------------------------------------------------------

export { DEFAULT_HIDDEN_STATUSES };
export type { Task, TaskEntry, TaskStatus };
