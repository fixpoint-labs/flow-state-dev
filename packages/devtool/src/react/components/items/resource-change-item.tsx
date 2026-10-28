/**
 * Tier 3 (debug-only): Resource change indicator — subtle dot/line.
 */
import type { ResourceChangeItem } from "@flow-state-dev/core/items";

export function ResourceChangeItemView({ item }: { item: ResourceChangeItem }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-fs-ink3 font-fs-mono">
      <span className="inline-block size-1.5 box-border border border-fs-ink3 shrink-0" />
      <span className="text-fs-ink4">{item.changeType}</span>
      <span className="truncate">{item.resourcePath}</span>
      <span className="text-fs-ink4">({item.scope})</span>
    </div>
  );
}
