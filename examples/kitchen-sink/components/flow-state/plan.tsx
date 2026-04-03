"use client";

import type { ComponentItem } from "@flow-state-dev/core/items";
import { cn } from "@/lib/utils";
import {
  AlertTriangleIcon,
  ArrowUpCircleIcon,
  CheckCircle2Icon,
  CircleIcon,
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
  in_progress: {
    icon: Loader2Icon,
    iconClassName: "text-blue-500 animate-spin",
    label: "In progress",
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
        <p className="text-sm font-medium leading-snug">{plan.goal}</p>
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

function PlanTaskRow({ task }: { task: PlanTask }) {
  const config = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <li className="flex items-start gap-2">
      <Icon
        className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", config.iconClassName)}
        aria-hidden="true"
      />
      <span
        className={cn(
          "text-xs leading-snug",
          config.goalClassName
        )}
      >
        {task.goal}
        {task.error && (
          <span className="ml-1 opacity-60">— {task.error}</span>
        )}
      </span>
    </li>
  );
}
