/**
 * The harness's internal to-do list in a coding task's session view: each step's
 * title and status, live while the task runs and kept after it ends.
 */
import { ChevronRightIcon } from "lucide-react";
import type { RecordedWork } from "@flow-state-dev/harness-manager/browser";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { cn } from "@/lib/utils";
import { currentPlanIndex, planChecklistSummary, planStatusKind, planStatusLabel } from "./flow-state/plan-checklist";

type Plan = NonNullable<RecordedWork["plan"]>;

export function PlanChecklist({ plan, running }: { plan: Plan; running: boolean }) {
  const { rows, truncated } = plan;
  if (rows.length === 0) return null;
  const summary = planChecklistSummary(rows) ?? `${rows.length} steps`;
  const current = currentPlanIndex(rows);
  return (
    <Collapsible defaultOpen={running} data-plan-checklist className="group/plan w-full overflow-hidden rounded-lg border border-border bg-card/50">
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <CollapsibleTrigger
          aria-label="Show or hide the harness plan steps"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronRightIcon
            aria-hidden
            className="size-3.5 shrink-0 -rotate-90 text-muted-foreground transition-transform group-data-[state=closed]/plan:rotate-90"
          />
          <span className="truncate font-mono text-xs text-text-2" data-plan-summary>
            {summary}
          </span>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="border-t border-border px-3 py-2 outline-none">
        <ol className="flex flex-col gap-1">
          {rows.map((row, index) => {
            const kind = planStatusKind(row.status);
            const active = index === current;
            return (
              <li
                key={row.id}
                data-plan-row
                data-plan-status={kind}
                className={cn(
                  "flex items-start gap-2 rounded-md px-1.5 py-0.5 font-mono text-xs",
                  active ? "bg-surface-raised/80 text-foreground" : "text-text-2",
                )}
              >
                <span className="w-20 shrink-0 text-xs tracking-wide text-muted-foreground uppercase" aria-hidden>
                  {planStatusLabel(kind)}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap">{row.title}</span>
              </li>
            );
          })}
        </ol>
        {truncated ? (
          <p className="mt-1.5 font-mono text-xs text-muted-foreground">More steps were recorded than this view shows.</p>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}