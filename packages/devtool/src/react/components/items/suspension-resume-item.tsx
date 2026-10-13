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
    <div className="flex items-center gap-2 py-1 font-fs-mono text-[10.5px] font-medium text-fs-ink3">
      <span className="h-px w-4 shrink-0 bg-fs-ink/20" aria-hidden />
      <PlayCircle className="h-3 w-3 shrink-0 text-fs-green" aria-hidden />
      <span className="uppercase tracking-[.12em]">resumed</span>
      <span className="text-fs-ink2">{item.resolution}</span>
      {item.resolvedBy !== undefined && item.resolvedBy.length > 0 && (
        <span className="truncate text-fs-ink4">by {item.resolvedBy}</span>
      )}
    </div>
  );
}
