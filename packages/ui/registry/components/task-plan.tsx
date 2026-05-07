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
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ToolOutputItem,
  MessageItem,
  OutputItem,
  ReasoningItem,
} from "@flow-state-dev/core/items";
import Markdown from "react-markdown";
import { extractToolCallSummary } from "./tool-summaries";
import { cn } from "@/lib/utils";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  CircleSlashIcon,
  EyeIcon,
  HelpCircleIcon,
  Loader2Icon,
  PauseCircleIcon,
  RotateCcwIcon,
  WrenchIcon,
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

  // Track which task rows are currently expanded so we can decide
  // whether the user is actively reading at the moment the board
  // transitions to fully-done.
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(
    () => new Set()
  );
  const handleTaskOpenChange = useCallback(
    (taskId: string, open: boolean) => {
      setExpandedTaskIds((prev) => {
        const has = prev.has(taskId);
        if (open === has) return prev;
        const next = new Set(prev);
        if (open) {
          next.add(taskId);
        } else {
          next.delete(taskId);
        }
        return next;
      });
    },
    []
  );

  // "Fully done" — board has reached its completed phase AND no tasks
  // are still in a non-terminal status.
  const isFullyDone = useMemo(() => {
    if (state.boardMeta.status !== "completed") return false;
    return state.tasks.every(
      (entry) =>
        entry.task.status !== "pending" &&
        entry.task.status !== "in_progress" &&
        entry.task.status !== "blocked" &&
        entry.task.status !== "awaiting_review"
    );
  }, [state.boardMeta.status, state.tasks]);

  // Card-level open state. Auto-collapses on the rising edge of
  // fully-done IFF no task row is expanded at that moment (the
  // user might be reading). Manual user toggles after that point
  // are sticky — auto-collapse only fires once per fully-done
  // transition.
  const [boardOpen, setBoardOpen] = useState(true);
  const autoCollapseFiredRef = useRef(false);
  const expandedTaskIdsRef = useRef(expandedTaskIds);
  expandedTaskIdsRef.current = expandedTaskIds;

  useEffect(() => {
    if (isFullyDone) {
      if (!autoCollapseFiredRef.current) {
        autoCollapseFiredRef.current = true;
        if (expandedTaskIdsRef.current.size === 0) {
          setBoardOpen(false);
        }
      }
    } else {
      autoCollapseFiredRef.current = false;
    }
  }, [isFullyDone]);

  if (state.tasks.length === 0) {
    if (hideEmpty) return null;
    return (
      <div
        className={cn(
          "not-prose my-2 rounded-md border bg-card text-card-foreground",
          className
        )}
      >
        <TaskPlanHeader
          title={title ?? "Tasks"}
          collectionId={collectionId}
          boardStatus={state.boardMeta.status}
          completed={0}
          total={0}
          open={boardOpen}
          onToggle={() => setBoardOpen((prev) => !prev)}
        />
        {boardOpen && (
          <p className="px-3 py-3 text-xs text-muted-foreground italic">
            No tasks yet
          </p>
        )}
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
        "not-prose my-2 rounded-md border bg-card text-card-foreground",
        className
      )}
    >
      <TaskPlanHeader
        title={title ?? "Tasks"}
        collectionId={collectionId}
        boardStatus={state.boardMeta.status}
        completed={completedCount}
        total={totalCount}
        open={boardOpen}
        onToggle={() => setBoardOpen((prev) => !prev)}
      />
      {boardOpen && (
        <div className="space-y-3 px-3 py-3">
          {groups.map((group) => (
            <TaskPlanSection
              key={group.status as string}
              group={group}
              groupByAssignee={groupByAssignee}
              statusConfig={statusConfig}
              taskWindows={taskWindows}
              onTaskOpenChange={handleTaskOpenChange}
            />
          ))}
        </div>
      )}
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
  open,
  onToggle,
}: {
  title: string;
  collectionId: string;
  boardStatus?: string;
  completed: number;
  total: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left",
        open && "border-b"
      )}
    >
      <div className="flex items-center gap-2">
        <ChevronDownIcon
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200",
            !open && "-rotate-90"
          )}
          aria-hidden="true"
        />
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
    </button>
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
  onTaskOpenChange,
}: {
  group: StatusGroup;
  groupByAssignee: boolean;
  statusConfig?: Record<string, StatusConfig>;
  taskWindows: Map<string, OutputItem[]>;
  onTaskOpenChange: (taskId: string, open: boolean) => void;
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
                    onOpenChange={onTaskOpenChange}
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
              onOpenChange={onTaskOpenChange}
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
  onOpenChange,
}: {
  entry: TaskEntry;
  statusConfig?: Record<string, StatusConfig>;
  windowItems?: OutputItem[];
  onOpenChange?: (taskId: string, open: boolean) => void;
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
  const outputText = useMemo(() => extractTaskOutputText(task), [task]);
  const hasWindow =
    (windowItems?.length ?? 0) > 0 || outputText !== null;

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

  // Report open-state up to the parent so it can decide whether to
  // auto-collapse the whole board on completion. Always report current
  // state on mount; clean up on unmount so a removed row doesn't keep
  // a stale "expanded" entry pinning the board open.
  useEffect(() => {
    onOpenChange?.(task.id, open);
  }, [open, task.id, onOpenChange]);
  useEffect(() => {
    return () => {
      onOpenChange?.(task.id, false);
    };
  }, [task.id, onOpenChange]);

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
        <div className="mt-1.5 pl-5">
          <TaskWindowTimeline
            windowItems={windowItems}
            outputText={outputText}
          />
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
// Task output (the worker's final result, captured on collection.complete)
// ---------------------------------------------------------------------------

/**
 * Extract a text representation of `task.output` for display.
 *
 * The substrate stores whatever the worker returned. Common shapes:
 *   - plain string (e.g. supervisor's `outputSchema: z.string()`)
 *   - `{ summary, success, reason?, sources? }` (P&E default executor)
 *   - arbitrary structured object (custom workers)
 *
 * Returns `null` when there is no output yet (in-progress tasks) or when
 * the output is empty. Object shapes with a known `summary` field surface
 * that field; unknown shapes pretty-print as JSON so nothing is silently
 * swallowed.
 */
function extractTaskOutputText(task: Task): string | null {
  const value = task.output;
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
          ? `\n\n${obj.reason}`
          : "";
      return summary + reason;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return null;
    }
  }
  return String(value);
}

const taskOutputHeading = ({ children }: { children?: React.ReactNode }) => (
  <p className="font-semibold">{children}</p>
);

/**
 * Renders the task's output text as Markdown. Mirrors the styling used
 * for evented-actors entries so per-pattern expansions feel
 * consistent.
 */
function TaskOutput({ text }: { text: string }) {
  return (
    <div
      className={cn(
        "prose-none text-xs leading-snug text-muted-foreground",
        "[&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-0.5",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[10px]",
        "[&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-2 [&_blockquote]:italic"
      )}
    >
      <Markdown
        components={{
          h1: taskOutputHeading,
          h2: taskOutputHeading,
          h3: taskOutputHeading,
          h4: taskOutputHeading,
          h5: taskOutputHeading,
          h6: taskOutputHeading,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-task expansion timeline
// ---------------------------------------------------------------------------

/**
 * Renders a task's windowed items + final output as a vertical
 * timeline, matching evented-actors's `<Step>` / `<StepItem>`
 * vocabulary. Tool calls collapse to a compact one-liner
 * (`<TaskToolItem>`) — the chat-thread `<ToolGroup>` card style is
 * deliberately not used here because nesting card-shaped chrome
 * inside a section card stacks frames and reads poorly.
 *
 * Item dispatch:
 *   - `block_tool_output`        → `<TaskToolItem>`
 *   - `message`                  → compact line (assistant text only)
 *   - `reasoning`                → muted compact line
 *   - everything else            → ignored (block_output is hidden by
 *     design — `task.output` carries the canonical worker result and
 *     renders as the timeline's final entry via `<TaskOutput>`)
 */
function TaskWindowTimeline({
  windowItems,
  outputText,
}: {
  windowItems?: OutputItem[];
  outputText: string | null;
}) {
  const renderable: Array<
    | { kind: "tool"; item: ToolOutputItem }
    | { kind: "message"; item: MessageItem }
    | { kind: "reasoning"; item: ReasoningItem }
  > = [];

  for (const item of windowItems ?? []) {
    if (item.type === "tool_output") {
      renderable.push({ kind: "tool", item: item as ToolOutputItem });
    } else if (item.type === "message") {
      renderable.push({ kind: "message", item: item as MessageItem });
    } else if (item.type === "reasoning") {
      renderable.push({ kind: "reasoning", item: item as ReasoningItem });
    }
  }

  const hasOutput = outputText !== null;
  const hasItems = renderable.length > 0;

  if (!hasOutput && !hasItems) return null;

  const total = renderable.length + (hasOutput ? 1 : 0);

  // Single-item expansions render flat — the dot + connector vocabulary
  // implies a sequence, and a sequence of one is just visual noise.
  if (total === 1) {
    if (hasOutput) {
      return (
        <div className="pt-1">
          <TaskOutput text={outputText!} />
        </div>
      );
    }
    const only = renderable[0]!;
    return (
      <div className="pt-1">
        {only.kind === "tool" ? (
          <TaskToolItem item={only.item} />
        ) : only.kind === "message" ? (
          <MessageLine item={only.item} />
        ) : (
          <ReasoningLine item={only.item} />
        )}
      </div>
    );
  }

  return (
    <div className="pt-1">
      {renderable.map((entry, i) => {
        const isLast = i === total - 1;
        if (entry.kind === "tool") {
          return (
            <StepItem key={entry.item.id} isLast={isLast}>
              <TaskToolItem item={entry.item} />
            </StepItem>
          );
        }
        if (entry.kind === "message") {
          return (
            <StepItem key={entry.item.id} isLast={isLast}>
              <MessageLine item={entry.item} />
            </StepItem>
          );
        }
        return (
          <StepItem key={entry.item.id} isLast={isLast}>
            <ReasoningLine item={entry.item} />
          </StepItem>
        );
      })}
      {hasOutput && (
        <StepItem isLast>
          <TaskOutput text={outputText!} />
        </StepItem>
      )}
    </div>
  );
}

/**
 * Vertical-timeline row connector — bullet on a connector line, content
 * to the right. Lifted from evented-actors's `<StepItem>` so
 * task-plan and evented-actors share the same visual vocabulary.
 */
function StepItem({
  isLast,
  children,
}: {
  isLast?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <div className="flex flex-col items-center">
        <div className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
        {!isLast && <div className="w-px flex-1 bg-muted-foreground/25" />}
      </div>
      <div className="min-w-0 flex-1 pb-1.5">{children}</div>
    </div>
  );
}

/**
 * Compact tool-call row mirroring evented-actors's
 * `<ToolCallItem>`. Flat line for tools with no result detail;
 * expandable `<details>` for tools that returned a list of results.
 */
function TaskToolItem({ item }: { item: ToolOutputItem }) {
  const summary = useMemo(() => extractToolCallSummary(item), [item]);
  const label = summary.query ?? summary.displayName;
  const hasResults =
    summary.resultSummary !== undefined && summary.resultSummary.length > 0;

  if (!hasResults) {
    return (
      <div className="flex items-center gap-1 text-xs leading-snug">
        <WrenchIcon
          className="h-3 w-3 shrink-0 text-muted-foreground/50"
          aria-hidden="true"
        />
        <span className="font-medium text-foreground/70">
          {summary.displayName}
        </span>
        {summary.query !== undefined && (
          <span className="truncate text-muted-foreground">
            — {summary.query}
          </span>
        )}
      </div>
    );
  }

  return (
    <details className="group/tool">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs leading-snug">
        <WrenchIcon
          className="h-3 w-3 shrink-0 text-muted-foreground/50"
          aria-hidden="true"
        />
        <span className="font-medium text-foreground/70">
          {summary.displayName}
        </span>
        <span className="flex-1 truncate text-muted-foreground">— {label}</span>
        <ChevronDownIcon
          className="h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform group-open/tool:-rotate-180"
          aria-hidden="true"
        />
      </summary>
      <ul className="mt-1 space-y-0.5 pl-1">
        {summary.resultSummary!.map((r, i) => (
          <li
            key={i}
            className="truncate text-[10px] text-muted-foreground/70"
          >
            {r}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Single-line message renderer — assistant `output_text` only, joined
 * across content parts. Tool/file content is ignored here; tool calls
 * already render via `<TaskToolItem>`.
 */
function MessageLine({ item }: { item: MessageItem }) {
  const text = item.content
    .filter((c) => c.type === "output_text")
    .map((c) => (c as { text: string }).text)
    .join("");
  if (text.length === 0) return null;
  return (
    <p className="whitespace-pre-wrap text-xs leading-snug text-foreground/80">
      {text}
    </p>
  );
}

/**
 * Single-line reasoning renderer — muted to signal "model thinking",
 * not user-facing content.
 */
function ReasoningLine({ item }: { item: ReasoningItem }) {
  const text = (item as ReasoningItem & { text?: string }).text ?? "";
  if (text.length === 0) return null;
  return (
    <p className="whitespace-pre-wrap text-[11px] italic leading-snug text-muted-foreground/70">
      {text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Re-exports for consumer ergonomics
// ---------------------------------------------------------------------------

export { DEFAULT_HIDDEN_STATUSES };
export type { Task, TaskEntry, TaskStatus };
