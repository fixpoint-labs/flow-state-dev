/**
 * Inline renderer for `suspension` items (FIX-141).
 *
 * A suspension item is emitted when a durable action calls `ctx.suspend()`.
 * It carries the human-facing `message`, the `suspensionStatus`, and the
 * `reason`. Rendered as a compact pause-marker row in the stream; full
 * resolution happens in the Suspensions tab.
 */
import type { SuspensionItem } from "@flow-state-dev/core/items";
import { PauseCircle } from "lucide-react";

export function SuspensionItemView({ item }: { item: SuspensionItem }) {
  return (
    <div className="flex items-center gap-2 text-xs text-fs-ink2 py-0.5">
      <PauseCircle className="h-3 w-3 shrink-0 text-fs-ink3" aria-hidden />
      <span className="font-fs-mono text-[10.5px] font-medium uppercase tracking-[.12em] text-fs-ink3">suspended</span>
      <span className="font-fs-mono text-[11px] text-fs-ink3">{item.reason}</span>
      {item.message.length > 0 && (
        <span className="truncate text-fs-ink">{item.message}</span>
      )}
      <span
        className={`shrink-0 px-1 font-fs-mono text-[9.5px] font-medium uppercase tracking-[.08em] ${
          // Highlighter only while a person still has to act on the gate.
          item.suspensionStatus === "pending" ? "bg-fs-hl text-fs-on-hl" : "border border-fs-ink/45 text-fs-ink3"
        }`}
      >
        {item.suspensionStatus}
      </span>
    </div>
  );
}
