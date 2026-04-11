"use client";

import React, { useMemo } from "react";
import type { ComponentItem, ContainerItem, OutputItem } from "@flow-state-dev/core/items";
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

// ---------------------------------------------------------------------------
// Types (inlined to keep the component registry-distributable without
// requiring @flow-state-dev/patterns as a runtime dependency)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

type StatusConfig = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>;
  iconClassName: string;
  goalClassName?: string;
  label: string;
};

const STATUS_CONFIG: Record<PlanTaskStatus, StatusConfig> = {
  pending: {
    icon: CircleIcon,
    iconClassName: "text-muted-foreground",
    label: "Pending",
  },
  "in-progress": {
    icon: Loader2Icon,
    iconClassName: "text-blue-500 animate-spin",
    label: "In progress",
  },
  "awaiting-review": {
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
  failed: {
    icon: XCircleIcon,
    iconClassName: "text-destructive",
    goalClassName: "text-destructive",
    label: "Failed",
  },
  skipped: {
    icon: MinusCircleIcon,
    iconClassName: "text-muted-foreground",
    goalClassName: "text-muted-foreground line-through",
    label: "Skipped",
  },
  "needs-revision": {
    icon: AlertTriangleIcon,
    iconClassName: "text-amber-500",
    label: "Needs revision",
  },
  escalated: {
    icon: ArrowUpCircleIcon,
    iconClassName: "text-purple-500",
    label: "Escalated",
  },
};

/** Extracts a human-readable summary from a task result if one is present. */
function getResultSummary(result: unknown): string | undefined {
  if (result === null || result === undefined) return undefined;
  if (typeof result === "string") return result;
  if (typeof result === "object" && "summary" in (result as object)) {
    const s = (result as { summary: unknown }).summary;
    return typeof s === "string" ? s : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * Renders a point-in-time plan snapshot emitted via emitPlanSnapshot().
 *
 * Register via:
 *   <FlowProvider renderers={{ component: { plan: Plan } }}>
 *
 * Or use chatAssistantRenderers from the chat-assistant component which
 * includes this renderer by default.
 */
export function Plan({ item }: { item: ComponentItem }) {
  const plan = item.data as Plan;

  const completedCount = plan.tasks.filter(
    (t) => t.status === "completed"
  ).length;

  return (
    <div className="not-prose my-2 rounded-md border bg-card p-3 text-card-foreground">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">Steps</p>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {completedCount}/{plan.tasks.length}
          {plan.iteration !== undefined && plan.iteration > 0 &&
            ` · pass ${plan.iteration + 1}`}
        </span>
      </div>
      <ul className="space-y-1.5">
        {plan.tasks.map((task) => (
          <PlanTaskRow key={task.id} task={task} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Container renderer for plan-and-execute sequencers.
 *
 * Receives a ContainerItem and resolves the plan state from owned items.
 * Register via:
 *   <FlowProvider renderers={{ container: { plan: PlanContainer } }}>
 *
 * @param item - The ContainerItem from the plan sequencer.
 * @param allItems - All session items (for filtering owned items by ownedBy).
 */
export function PlanContainer({
  item,
  allItems,
}: {
  item: ContainerItem;
  allItems: OutputItem[];
}) {
  const ownedBy = item.provenance.blockInstanceId;
  const state = useMemo(() => {
    // Find the latest ComponentItem matching the container's component key.
    if (item.component === undefined) return undefined;
    const key = item.component;
    for (let i = allItems.length - 1; i >= 0; i--) {
      const candidate = allItems[i];
      if (
        candidate.type === "component" &&
        (candidate as ComponentItem).component === key &&
        (candidate as OutputItem & { ownedBy?: string }).ownedBy === ownedBy
      ) {
        return (candidate as ComponentItem).data as Plan;
      }
    }
    return undefined;
  }, [item.component, allItems, ownedBy]);

  if (!state) return null;

  const completedCount = state.tasks.filter(
    (t) => t.status === "completed"
  ).length;

  return (
    <div className="not-prose my-2 rounded-md border bg-card p-3 text-card-foreground">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">Steps</p>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {completedCount}/{state.tasks.length}
          {state.iteration !== undefined && state.iteration > 0 &&
            ` · pass ${state.iteration + 1}`}
        </span>
      </div>
      <ul className="space-y-1.5">
        {state.tasks.map((task) => (
          <PlanTaskRow key={task.id} task={task} />
        ))}
      </ul>
    </div>
  );
}

function PlanTaskRow({ task }: { task: PlanTask }) {
  const config = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending;
  const Icon = config.icon;
  const summary = getResultSummary(task.result);
  const assigneeLabel = task.assignee ? (
    <span className="ml-1 shrink-0 text-[10px] font-medium text-muted-foreground/60">
      [{task.assignee}]
    </span>
  ) : null;

  if (!summary) {
    return (
      <li className="flex items-start gap-2">
        <Icon
          className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", config.iconClassName)}
          aria-hidden="true"
        />
        <span className={cn("text-xs leading-snug", config.goalClassName)}>
          {task.goal}{assigneeLabel}
          {task.error && (
            <span className="ml-1 opacity-60">— {task.error}</span>
          )}
        </span>
      </li>
    );
  }

  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2">
          <Icon
            className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", config.iconClassName)}
            aria-hidden="true"
          />
          <span className={cn("flex-1 text-xs leading-snug", config.goalClassName)}>
            {task.goal}{assigneeLabel}
          </span>
          <ChevronRightIcon
            className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        </summary>
        <p className="mt-1 whitespace-pre-wrap pl-5 text-xs leading-snug text-muted-foreground">
          {summary}
        </p>
      </details>
    </li>
  );
}
