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
    <div className="flex items-center gap-1.5 text-xs text-purple-300/90 py-0.5">
      <PauseCircle className="h-3 w-3 shrink-0 text-purple-400" aria-hidden />
      <span className="text-purple-400/80">suspended</span>
      <span className="text-slate-400">{item.reason}</span>
      {item.message.length > 0 && (
        <span className="truncate text-slate-300">{item.message}</span>
      )}
      <span className="text-[10px] text-slate-600">{item.suspensionStatus}</span>
    </div>
  );
}
