/**
 * Tier 2: Inline spinner + message text. Already minimal — no expand needed.
 *
 * Status items with an empty `message` are structural background-work signals
 * (see sequencer.ts auto-await) carrying only `backgroundTasks` metadata.
 * Render a synthesized label so the devtool trace isn't littered with blank
 * rows; hide entirely when there's truly no content to show.
 */
import type { StatusItem } from "@flow-state-dev/core/items";
import { Loader2 } from "lucide-react";

export function StatusItemView({ item }: { item: StatusItem }) {
  const itemWithBg = item as StatusItem & { backgroundTasks?: number };
  const hasMessage = typeof item.message === "string" && item.message.length > 0;
  const backgroundTasks = itemWithBg.backgroundTasks;

  let label: string | null = null;
  if (hasMessage) {
    label = item.message;
  } else if (typeof backgroundTasks === "number") {
    label =
      backgroundTasks === 0
        ? "background work complete"
        : `background tasks: ${backgroundTasks} pending`;
  }

  if (label === null) return null;

  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500 py-0.5">
      <Loader2 className="h-3 w-3 animate-spin shrink-0 text-slate-500" />
      <span>{label}</span>
    </div>
  );
}
