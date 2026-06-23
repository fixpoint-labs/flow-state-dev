/**
 * Inline renderer for `suspension_resume` items (FIX-811).
 *
 * A suspension_resume item is emitted into the resumed request's log when a
 * suspension is resolved and the same request continues. It is the audit
 * counterpart to the `suspension` item: it carries the `resolution`, the
 * resolver identity (`resolvedBy`), and when it resolved. Rendered as a compact
 * resume-marker row in the stream, paired visually with its suspension.
 */
import type { SuspensionResumeItem } from "@flow-state-dev/core/items";
import { PlayCircle } from "lucide-react";

export function SuspensionResumeItemView({ item }: { item: SuspensionResumeItem }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-emerald-300/90 py-0.5">
      <PlayCircle className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden />
      <span className="text-emerald-400/80">resumed</span>
      <span className="text-[10px] text-slate-600">{item.resolution}</span>
      {item.resolvedBy !== undefined && item.resolvedBy.length > 0 && (
        <span className="truncate text-slate-400">by {item.resolvedBy}</span>
      )}
    </div>
  );
}
