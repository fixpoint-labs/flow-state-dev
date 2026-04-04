"use client";

import type { ComponentItem, BlockToolOutputItem } from "@flow-state-dev/core/items";
import { cn } from "@/lib/utils";
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
 * Strategy: plan snapshots and tool calls share the same parentBlockInstanceId
 * (the executeNextTask sequencer instance). By diffing consecutive plan snapshots,
 * we identify which task was executed in each instance, then group tool calls
 * from block_tool_output items by that same parentBlockInstanceId.
 */
function buildTaskToolMap(
  allItems: ReturnType<typeof useSessionItems>
): Map<string, BlockToolOutputItem[]> {
  // All plan snapshot ComponentItems, sorted by emission order.
  const snapshots = allItems
    .filter((item) => item.type === "component" && (item as ComponentItem).component === "plan")
    .sort((a, b) => a.itemIndex - b.itemIndex) as ComponentItem[];

  // Map parentBlockInstanceId → task ID via snapshot diffing.
  const executionToTaskId = new Map<string, string>();

  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    const parentId = snapshot.provenance.parentBlockInstanceId;
    if (!parentId) continue;

    const plan = snapshot.data as Plan;
    const prevPlan = i > 0 ? (snapshots[i - 1].data as Plan) : null;

    let executedTaskId: string | undefined;

    if (prevPlan) {
      // Find the task that transitioned from in_progress → completed/failed.
      // Cascade-skipped tasks go pending → skipped, not in_progress → skipped.
      const prevById = new Map(prevPlan.tasks.map((t) => [t.id, t]));
      for (const task of plan.tasks) {
        const prev = prevById.get(task.id);
        if (prev?.status === "in_progress" && task.status !== "in_progress") {
          executedTaskId = task.id;
          break;
        }
      }
    } else {
      // First snapshot: the task that just became completed or failed.
      executedTaskId = plan.tasks.find(
        (t) => t.status === "completed" || t.status === "failed"
      )?.id;
    }

    if (executedTaskId) {
      executionToTaskId.set(parentId, executedTaskId);
    }
  }

  // All block_tool_output items, grouped by parentBlockInstanceId.
  const toolsByExecution = new Map<string, BlockToolOutputItem[]>();
  for (const item of allItems) {
    if (item.type !== "block_tool_output") continue;
    const parentId = item.provenance.parentBlockInstanceId;
    if (!parentId) continue;
    if (!toolsByExecution.has(parentId)) toolsByExecution.set(parentId, []);
    toolsByExecution.get(parentId)!.push(item as BlockToolOutputItem);
  }

  // Invert: task ID → tool calls.
  const taskToolMap = new Map<string, BlockToolOutputItem[]>();
  for (const [parentId, taskId] of executionToTaskId) {
    const tools = toolsByExecution.get(parentId);
    if (tools && tools.length > 0) {
      taskToolMap.set(taskId, tools);
    }
  }

  return taskToolMap;
}

export function Plan({ item }: { item: ComponentItem }) {
  const allItems = useSessionItems();
  const plan = item.data as Plan;
  const completedCount = plan.tasks.filter((t) => t.status === "completed").length;

  const taskToolMap = useMemo(() => buildTaskToolMap(allItems), [allItems]);

  return (
    <div className="not-prose my-2 rounded-md border bg-card p-3 text-card-foreground">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{plan.goal}</p>
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
