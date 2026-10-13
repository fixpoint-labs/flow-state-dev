/**
 * Tier 3 (debug-only): State mutation indicator — subtle dot/line.
 */
import type { StateChangeItem } from "@flow-state-dev/core/items";

export function StateChangeItemView({ item }: { item: StateChangeItem }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-fs-ink3 font-fs-mono">
      <span className="inline-block size-1.5 bg-fs-ink3 shrink-0" />
      <span className="text-fs-ink4">{item.scope}</span>
      <span>{item.operation}</span>
      {item.path && <span className="text-fs-ink4 truncate">{item.path}</span>}
    </div>
  );
}
