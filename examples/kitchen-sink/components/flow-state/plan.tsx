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
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { useMemo } from "react";
import Markdown from "react-markdown";
import { useSessionItems } from "./session-items-context";

type PlanTaskStatus =
  | "pending"
  | "in-progress"
  | "awaiting-review"
  | "completed"
  | "failed"
  | "skipped"
  | "needs-revision"
  | "escalated";

type PlanTask = {
  id: string;
  goal: string;
  assignee?: string;
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
 * Items are already scoped to this container via ownedBy, so no requestId
 * grouping is needed. Correlates tool calls to tasks by finding which task
 * transitioned between consecutive plan snapshots and windowing tool calls
 * by itemIndex between those snapshots.
 */
function buildTaskToolMap(
  ownedItems: OutputItem[]
): Map<string, BlockToolOutputItem[]> {
  const snapshots = ownedItems.filter(
    (item) => item.type === "component" && (item as ComponentItem).component === "plan"
  ) as ComponentItem[];
  snapshots.sort((a, b) => a.itemIndex - b.itemIndex);

  const tools = ownedItems.filter(
    (item) => item.type === "block_tool_output"
  ) as BlockToolOutputItem[];

  const result = new Map<string, BlockToolOutputItem[]>();

  for (let i = 1; i < snapshots.length; i++) {
    const prevSnap = snapshots[i - 1];
    const currSnap = snapshots[i];
    const prevPlan = prevSnap.data as Plan;
    const plan = currSnap.data as Plan;

    const prevById = new Map(prevPlan.tasks.map((t) => [t.id, t]));
    let executedTaskId: string | undefined;
    for (const task of plan.tasks) {
      const prev = prevById.get(task.id);
      if (
        (prev?.status === "pending" || prev?.status === "in-progress") &&
        (task.status === "completed" || task.status === "failed")
      ) {
        executedTaskId = task.id;
        break;
      }
    }

    if (!executedTaskId) continue;

    const taskTools = tools.filter(
      (t) => t.itemIndex > prevSnap.itemIndex && t.itemIndex < currSnap.itemIndex
    );
    if (taskTools.length > 0) {
      result.set(executedTaskId, taskTools);
    }
  }

  return result;
}

/**
 * Container renderer for plan-and-execute and supervisor sequencers.
 *
 * Register via:
 *   <FlowProvider renderers={{ container: { plan: Plan } }}>
 *
 * Uses useContainerItems to resolve owned items and extract the plan state.
 * Items owned by this container (tool calls, plan snapshots, messages) are
 * automatically suppressed from top-level rendering by ItemRenderer when
 * this container renderer is registered.
 */
export function Plan({ item }: { item: ContainerItem }) {
  const allItems = useSessionItems();
  const { state: plan, items: ownedItems } = useContainerItems<Plan>(
    item,
    allItems
  );

  const taskToolMap = useMemo(
    () => buildTaskToolMap(ownedItems),
    [ownedItems]
  );

  if (!plan) return null;

  const completedCount = plan.tasks.filter((t) => t.status === "completed").length;

  return (
    <div className="not-prose my-2 rounded-md border bg-card p-3 text-card-foreground">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">Tasks</p>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {completedCount}/{plan.tasks.length}
          {plan.iteration !== undefined && plan.iteration > 0 && ` · pass ${plan.iteration}`}
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
  task: PlanTask;
  toolCalls?: BlockToolOutputItem[];
}) {
  const config = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending;
  const Icon = config.icon;
  const summary = getResultSummary(task.result);
  const hasDetails = summary || (toolCalls && toolCalls.length > 0);

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
          {toolCalls && toolCalls.length > 0 && (
            <ul className="space-y-0.5">
              {toolCalls.map((tc) => (
                <ToolCallLine key={tc.id} item={tc} />
              ))}
            </ul>
          )}
          {summary && (
            <TaskMarkdown text={summary} />
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
