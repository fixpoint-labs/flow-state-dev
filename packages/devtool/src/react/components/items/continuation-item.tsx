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
    <div className="flex items-center gap-1.5 text-xs text-amber-300/90 py-0.5">
      <RotateCcw className="h-3 w-3 shrink-0 text-amber-400" aria-hidden />
      <span className="text-amber-400/80">continued here</span>
      <span className="text-[10px] text-slate-600">
        {count} prior item{count === 1 ? "" : "s"}
      </span>
    </div>
  );
}
