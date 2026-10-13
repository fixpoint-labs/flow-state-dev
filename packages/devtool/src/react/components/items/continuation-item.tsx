/**
 * Inline renderer for `continuation` items (FIX-865).
 *
 * A continuation item is emitted into a request's log when a durable action
 * re-enters after a crash mid-execution (the `/continue` route). It marks the
 * seam between the prior durable log and the live re-run that followed —
 * analogous to `suspension_resume`, but for crash recovery rather than a
 * resolved HITL gate. Rendered as a compact boundary-marker row in the
 * stream, matching `SuspensionResumeItemView`'s visual pattern.
 */
import type { ContinuationItem } from "@flow-state-dev/core/items";
import { RotateCcw } from "lucide-react";

export function ContinuationItemView({ item }: { item: ContinuationItem }) {
  const count = item.priorItemCount;
  return (
    <div className="flex items-center gap-2 py-1 font-fs-mono text-[10.5px] font-medium text-fs-ink3">
      <span className="h-px w-4 shrink-0 bg-fs-ink/20" aria-hidden />
      <RotateCcw className="h-3 w-3 shrink-0 text-fs-ink3" aria-hidden />
      <span className="uppercase tracking-[.12em]">continued here</span>
      <span className="text-fs-ink4">
        {count} prior item{count === 1 ? "" : "s"}
      </span>
    </div>
  );
}
