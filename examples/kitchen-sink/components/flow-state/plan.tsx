"use client";

import type { ComponentItem, BlockToolOutputItem, BlockOutputItem } from "@flow-state-dev/core/items";
import { cn } from "@/lib/utils";
import { Tool } from "./tool";
import {
  AlertTriangleIcon,
  ArrowUpCircleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  Loader2Icon,
  MinusCircleIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { useMemo } from "react";
import { useSessionItems } from "./session-items-context";

type PlanTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "skipped"
  | "needs-revision"
  | "escalated";

type PlanTask = {
  id: string;
  goal: string;
  status: PlanTaskStatus;
  result?: unknown;
  error?: string;
};

type Plan = {
  goal: string;
  tasks: PlanTask[];
  status?: string;
  iteration?: number;
};

type StatusConfig = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>;
  iconClassName: string;
  goalClassName?: string;
  label: string;
};

const STATUS_CONFIG: Record<PlanTaskStatus, StatusConfig> = {
  pending: { icon: CircleIcon, iconClassName: "text-muted-foreground", label: "Pending" },
  in_progress: { icon: Loader2Icon, iconClassName: "text-blue-500 animate-spin", label: "In progress" },
  completed: { icon: CheckCircle2Icon, iconClassName: "text-green-500", goalClassName: "text-muted-foreground line-through", label: "Completed" },
  failed: { icon: XCircleIcon, iconClassName: "text-destructive", goalClassName: "text-destructive", label: "Failed" },
  skipped: { icon: MinusCircleIcon, iconClassName: "text-muted-foreground", goalClassName: "text-muted-foreground line-through", label: "Skipped" },
  "needs-revision": { icon: AlertTriangleIcon, iconClassName: "text-amber-500", label: "Needs revision" },
  escalated: { icon: ArrowUpCircleIcon, iconClassName: "text-purple-500", label: "Escalated" },
};

function getResultSummary(result: unknown): string | undefined {
  if (result === null || result === undefined) return undefined;
  if (typeof result === "object" && "summary" in (result as object)) {
    const s = (result as { summary: unknown }).summary;
    return typeof s === "string" ? s : undefined;
  }
  return undefined;
}

/**
 * Build a map from task ID → tool calls that ran during that task's execution.
 *
 * Strategy: correlate by itemIndex within a request.
 *
 * Plan snapshots are emitted twice per task cycle:
 *   1. captureAndPlan — initial baseline (all tasks pending)
 *   2. recordResult   — after each task completes/fails
 *
 * findTask never emits a snapshot, so no snapshot ever shows a task as
 * in_progress. Tool calls for task N fall between snapshot[N-1] and snapshot[N]
 * in itemIndex order, within the same request. We use this window to assign
 * tool calls to tasks without needing parentBlockInstanceId traversal.
 */
type TaskToolResult = {
  taskToolMap: Map<string, BlockToolOutputItem[]>;
};

function buildTaskToolMap(
  allItems: ReturnType<typeof useSessionItems>
): TaskToolResult {
  // All plan snapshot ComponentItems, grouped by request then sorted by itemIndex.
  const allSnapshots = allItems.filter(
    (item) => item.type === "component" && (item as ComponentItem).component === "plan"
  ) as ComponentItem[];

  const snapshotsByRequest = new Map<string, ComponentItem[]>();
  for (const snap of allSnapshots) {
    const req = snap.requestId;
    if (!snapshotsByRequest.has(req)) snapshotsByRequest.set(req, []);
    snapshotsByRequest.get(req)!.push(snap);
  }
  for (const snaps of snapshotsByRequest.values()) {
    snaps.sort((a, b) => a.itemIndex - b.itemIndex);
  }

  // Group tool outputs by requestId for range lookups.
  const toolsByRequest = new Map<string, BlockToolOutputItem[]>();
  for (const item of allItems) {
    if (item.type !== "block_tool_output") continue;
    const req = item.requestId;
    if (!toolsByRequest.has(req)) toolsByRequest.set(req, []);
    toolsByRequest.get(req)!.push(item as BlockToolOutputItem);
  }

  const taskToolMap = new Map<string, BlockToolOutputItem[]>();

  for (const [requestId, snaps] of snapshotsByRequest) {
    const reqTools = toolsByRequest.get(requestId) ?? [];

    for (let i = 1; i < snaps.length; i++) {
      const prevSnap = snaps[i - 1];
      const currSnap = snaps[i];
      const plan = currSnap.data as Plan;
      const prevPlan = prevSnap.data as Plan;

      // Find the task that transitioned from pending/in_progress → completed/failed.
      // findTask never emits a snapshot, so "in_progress" never appears in snapshots.
      const prevById = new Map(prevPlan.tasks.map((t) => [t.id, t]));
      let executedTaskId: string | undefined;
      for (const task of plan.tasks) {
        const prev = prevById.get(task.id);
        if (
          (prev?.status === "pending" || prev?.status === "in_progress") &&
          (task.status === "completed" || task.status === "failed")
        ) {
          executedTaskId = task.id;
          break;
        }
      }

      if (!executedTaskId) continue;

      // Tool calls for this task fall between the two snapshots in itemIndex order.
      const taskTools = reqTools.filter(
        (t) => t.itemIndex > prevSnap.itemIndex && t.itemIndex < currSnap.itemIndex
      );
      if (taskTools.length > 0) {
        taskToolMap.set(executedTaskId, taskTools);
      }
    }

  }

  return { taskToolMap };
}

export function Plan({ item }: { item: ComponentItem }) {
  const allItems = useSessionItems();
  const plan = item.data as Plan;
  const completedCount = plan.tasks.filter((t) => t.status === "completed").length;

  const { taskToolMap } = useMemo(() => buildTaskToolMap(allItems), [allItems]);

  return (
    <div className="not-prose my-2 rounded-md border bg-card p-3 text-card-foreground">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">Tasks</p>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {completedCount}/{plan.tasks.length}
          {plan.iteration !== undefined && plan.iteration > 0 && ` · pass ${plan.iteration + 1}`}
        </span>
      </div>
      <ul className="space-y-1.5">
        {plan.tasks.map((task) => (
          <PlanTaskRow key={task.id} task={task} toolCalls={taskToolMap.get(task.id)} />
        ))}
      </ul>
    </div>
  );
}

function PlanTaskRow({
  task,
  toolCalls,
}: {
  task: PlanTask;
  toolCalls?: BlockToolOutputItem[];
}) {
  const config = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending;
  const Icon = config.icon;
  const summary = getResultSummary(task.result);
  const hasDetails = summary || (toolCalls && toolCalls.length > 0);

  if (!hasDetails) {
    return (
      <li className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", config.iconClassName)} aria-hidden="true" />
        <span className={cn("text-xs leading-snug", config.goalClassName)}>
          {task.goal}
          {task.error && <span className="ml-1 opacity-60">— {task.error}</span>}
        </span>
      </li>
    );
  }

  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2">
          <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", config.iconClassName)} aria-hidden="true" />
          <span className={cn("flex-1 text-xs leading-snug", config.goalClassName)}>
            {task.goal}
          </span>
          <ChevronRightIcon
            className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-1.5 space-y-1.5 pl-5">
          {toolCalls && toolCalls.length > 0 && (
            <ul className="space-y-0.5">
              {toolCalls.map((tc) => (
                <ToolCallLine key={tc.id} item={tc} />
              ))}
            </ul>
          )}
          {summary && (
            <p className="text-xs leading-snug text-muted-foreground">{summary}</p>
          )}
        </div>
      </details>
    </li>
  );
}

function ToolCallLine({ item }: { item: BlockToolOutputItem }) {
  const name = item.toolCall.name;
  const args = (() => {
    try { return JSON.parse(item.toolCall.arguments) as Record<string, unknown>; } catch { return {}; }
  })();
  // Show the first string argument value as a brief label, if any.
  const argPreview = Object.values(args).find((v) => typeof v === "string") as string | undefined;

  return (
    <li className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
      <WrenchIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="font-mono">{name}</span>
      {argPreview && (
        <span className="truncate opacity-60">({argPreview})</span>
      )}
    </li>
  );
}

/**
 * Returns true if this tool call belongs to a plan execution (same request).
 * When a request contains plan snapshots, the plan component is the primary UI
 * for that request — all tool calls (step executors + synthesizer) are shown
 * contextually inside the plan and should not render as standalone cards.
 */
function isPlanOwnedToolCall(
  item: BlockToolOutputItem,
  allItems: ReturnType<typeof useSessionItems>
): boolean {
  return allItems.some(
    (i) =>
      i.type === "component" &&
      (i as ComponentItem).component === "plan" &&
      i.requestId === item.requestId
  );
}

/**
 * Renders a block_tool_output item as a Tool card, but suppresses it when
 * the tool call belongs to a plan task (shown inline there instead).
 */
export function PlanAwareTool({ item }: { item: BlockOutputItem | BlockToolOutputItem }) {
  const allItems = useSessionItems();
  if (item.type === "block_tool_output" && isPlanOwnedToolCall(item as BlockToolOutputItem, allItems)) {
    return null;
  }
  return <Tool item={item} />;
}
