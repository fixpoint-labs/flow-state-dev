"use client";

import type {
  ComponentItem,
  ContainerItem,
  BlockToolOutputItem,
  OutputItem,
} from "@flow-state-dev/core/items";
import { useContainerItems } from "@flow-state-dev/react";
import { cn } from "@/lib/utils";
import {
  AlertTriangleIcon,
  ArrowUpCircleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  EyeIcon,
  Loader2Icon,
  MinusCircleIcon,
  XCircleIcon,
} from "lucide-react";
import { useMemo } from "react";
import Markdown from "react-markdown";
import { useSessionItems } from "./session-items-context";
import { ToolGroup } from "./tool";

type PlanTaskStatus =
  | "pending"
  | "in-progress"
  | "awaiting-review"
  | "completed"
  | "failed"
  | "skipped"
  | "needs-revision"
  | "escalated";

type PlanMeta = {
  goal: string;
  taskOrder: string[];
  taskGoals: Record<string, string>;
  status?: string;
  iteration?: number;
};

type PlanTaskData = {
  id: string;
  goal: string;
  status: PlanTaskStatus;
  result?: unknown;
  error?: string;
  feedback?: string;
  assignee?: string;
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
  "in-progress": { icon: Loader2Icon, iconClassName: "text-blue-500 animate-spin", label: "In progress" },
  "awaiting-review": { icon: EyeIcon, iconClassName: "text-cyan-500", label: "Awaiting review" },
  completed: { icon: CheckCircle2Icon, iconClassName: "text-green-500", goalClassName: "text-muted-foreground line-through", label: "Completed" },
  failed: { icon: XCircleIcon, iconClassName: "text-destructive", goalClassName: "text-destructive", label: "Failed" },
  skipped: { icon: MinusCircleIcon, iconClassName: "text-muted-foreground", goalClassName: "text-muted-foreground line-through", label: "Skipped" },
  "needs-revision": { icon: AlertTriangleIcon, iconClassName: "text-amber-500", label: "Needs revision" },
  escalated: { icon: ArrowUpCircleIcon, iconClassName: "text-purple-500", label: "Escalated" },
};

function getResultSummary(result: unknown): string | undefined {
  if (result === null || result === undefined) return undefined;
  if (typeof result === "string") return result;
  if (typeof result === "object" && "summary" in (result as object)) {
    const s = (result as { summary: unknown }).summary;
    return typeof s === "string" ? s : undefined;
  }
  return undefined;
}

/**
 * Build a map from task ID → tool calls that ran during that task's execution.
 *
 * With per-task emissions, tool calls are windowed between a task's
 * "in-progress" and "completed"/"failed" plan-task items by itemIndex.
 */
function buildTaskToolMap(
  ownedItems: OutputItem[]
): Map<string, BlockToolOutputItem[]> {
  // Collect all plan-task component items, sorted by itemIndex.
  const taskItems = ownedItems.filter(
    (item) => item.type === "component" && (item as ComponentItem).component === "plan-task"
  ) as ComponentItem[];
  taskItems.sort((a, b) => a.itemIndex - b.itemIndex);

  const tools = ownedItems.filter(
    (item) => item.type === "block_tool_output"
  ) as BlockToolOutputItem[];

  const result = new Map<string, BlockToolOutputItem[]>();

  // For each task, find the "in-progress" → "completed"/"failed" window and
  // collect tool calls between those itemIndex values.
  const taskTimeline = new Map<string, { start?: number; end?: number }>();
  for (const item of taskItems) {
    const data = item.data as unknown as PlanTaskData;
    const entry = taskTimeline.get(data.id) ?? {};
    if (data.status === "in-progress" && entry.start === undefined) {
      entry.start = item.itemIndex;
    } else if (
      (data.status === "completed" || data.status === "failed") &&
      entry.end === undefined
    ) {
      entry.end = item.itemIndex;
    }
    taskTimeline.set(data.id, entry);
  }

  for (const [taskId, window] of taskTimeline) {
    if (window.start === undefined) continue;
    const endIdx = window.end ?? Infinity;
    const taskTools = tools.filter(
      (t) => t.itemIndex > window.start! && t.itemIndex < endIdx
    );
    if (taskTools.length > 0) {
      result.set(taskId, taskTools);
    }
  }

  return result;
}

/**
 * Container renderer for plan-and-execute and supervisor sequencers.
 * Composes the plan view from granular per-task ComponentItems emitted
 * by emitPlanMeta and emitTaskUpdate.
 *
 * Register via:
 *   <FlowProvider renderers={{ container: { plan: Plan } }}>
 */
export function Plan({ item }: { item: ContainerItem }) {
  const allItems = useSessionItems();
  const { items: ownedItems, componentsByKey } = useContainerItems(
    item,
    allItems
  );

  const { meta, tasks } = useMemo(() => {
    let planMeta: PlanMeta | undefined;
    const taskMap = new Map<string, PlanTaskData>();

    for (const [key, data] of componentsByKey) {
      if (key.endsWith(":plan-meta")) {
        planMeta = data as unknown as PlanMeta;
      } else if (key.includes("plan-task:")) {
        taskMap.set(key, data as unknown as PlanTaskData);
      }
    }

    const ordered: PlanTaskData[] = [];
    if (planMeta) {
      for (const id of planMeta.taskOrder) {
        const taskKey = [...taskMap.keys()].find((k) => k.endsWith(`plan-task:${id}`));
        if (taskKey) {
          ordered.push(taskMap.get(taskKey)!);
        } else {
          // Task listed in taskOrder but no individual update yet — show from meta
          ordered.push({
            id,
            goal: planMeta.taskGoals[id] ?? id,
            status: "pending",
          });
        }
      }
    }
    return { meta: planMeta, tasks: ordered };
  }, [componentsByKey]);

  const taskToolMap = useMemo(
    () => buildTaskToolMap(ownedItems),
    [ownedItems]
  );

  if (!meta) return null;

  const completedCount = tasks.filter((t) => t.status === "completed").length;

  return (
    <div className="not-prose my-2 rounded-md border bg-card p-3 text-card-foreground">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium leading-snug">Tasks</p>
          {meta.status === "reviewing" && (
            <span className="text-[10px] font-medium text-cyan-500">Reviewing…</span>
          )}
          {meta.status === "replanning" && (
            <span className="text-[10px] font-medium text-amber-500">Replanning…</span>
          )}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {completedCount}/{tasks.length}
          {meta.iteration !== undefined && meta.iteration > 0 && ` · pass ${meta.iteration}`}
        </span>
      </div>
      <ul className="space-y-1.5">
        {tasks.map((task) => (
          <PlanTaskRow key={task.id} task={task} toolCalls={taskToolMap.get(task.id)} />
        ))}
      </ul>
    </div>
  );
}

/** Renders markdown at text-xs scale with headings normalized to the same size. */
const headingComponent = ({ children }: { children?: React.ReactNode }) => (
  <p className="font-semibold">{children}</p>
);
const markdownComponents = {
  h1: headingComponent,
  h2: headingComponent,
  h3: headingComponent,
  h4: headingComponent,
  h5: headingComponent,
  h6: headingComponent,
};

function TaskMarkdown({ text }: { text: string }) {
  return (
    <div className="prose-none text-xs leading-snug text-muted-foreground [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-0.5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[10px] [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-2 [&_blockquote]:italic">
      <Markdown components={markdownComponents}>{text}</Markdown>
    </div>
  );
}

function PlanTaskRow({
  task,
  toolCalls,
}: {
  task: PlanTaskData;
  toolCalls?: BlockToolOutputItem[];
}) {
  const config = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending;
  const Icon = config.icon;
  const summary = getResultSummary(task.result);
  const showFeedback = task.feedback && (task.status === "needs-revision" || task.status === "escalated");
  const hasDetails = summary || showFeedback || (toolCalls && toolCalls.length > 0);

  const assigneeLabel = task.assignee ? (
    <span className="ml-1 shrink-0 text-[10px] font-medium text-muted-foreground/60">
      [{task.assignee}]
    </span>
  ) : null;

  if (!hasDetails) {
    return (
      <li className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", config.iconClassName)} aria-hidden="true" />
        <span className={cn("text-xs leading-snug", config.goalClassName)}>
          {task.goal}{assigneeLabel}
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
            {task.goal}{assigneeLabel}
          </span>
          <ChevronRightIcon
            className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-1.5 space-y-1.5 pl-5">
          {showFeedback && (
            <p className="whitespace-pre-wrap text-xs leading-snug text-amber-500/80">
              {task.feedback}
            </p>
          )}
          {toolCalls && toolCalls.length > 0 && (
            <ToolGroup className="my-1" items={toolCalls} />
          )}
          {summary && (
            <TaskMarkdown text={summary} />
          )}
        </div>
      </details>
    </li>
  );
}

