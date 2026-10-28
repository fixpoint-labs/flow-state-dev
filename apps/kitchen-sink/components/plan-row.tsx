"use client";

/**
 * One row of the harness session's plan panel: a mark for how far along it is,
 * and the title beside it, wrapping under the mark. The stage is read by
 * `planRowStage`; a status it does not know is shown as the harness said it.
 */
import { CircleCheck, Circle, LoaderCircle } from "lucide-react";

import { planRowStage } from "@/lib/harness-turn";

const MARK = {
  pending: <Circle className="size-4 text-muted-foreground" />,
  active: <LoaderCircle className="size-4 animate-spin text-foreground" />,
  done: <CircleCheck className="size-4 text-muted-foreground" />,
};

export function PlanRowLine({ rowKey, title, status }: { rowKey: string; title: string | null; status: string | null }) {
  const { stage, label } = planRowStage(status);
  return (
    <li className="flex items-start gap-2" data-testid="plan-row" data-stage={stage} data-status={status ?? undefined}>
      <span className="mt-0.5 shrink-0" role="img" aria-label={label} data-testid="plan-row-status">
        {MARK[stage === "other" ? "pending" : stage]}
      </span>
      <span className="min-w-0 break-words">
        <span
          data-testid="plan-row-title"
          className={stage === "done" ? "text-muted-foreground line-through" : stage === "active" ? "font-medium" : undefined}
        >
          {title ?? rowKey}
        </span>
        {stage === "other" && <span className="ml-2 text-xs text-muted-foreground">{label}</span>}
      </span>
    </li>
  );
}
