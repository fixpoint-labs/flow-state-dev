/**
 * Tier 3 (debug-only): Block debug config snapshot indicator.
 */
import type { BlockDebugItem } from "@flow-state-dev/core/items";

const KIND_COLORS: Record<string, string> = {
  generator: "bg-purple-500/60",
  handler: "bg-blue-500/60",
  sequencer: "bg-green-500/60",
  router: "bg-orange-500/60",
};

export function BlockDebugItemView({ item }: { item: BlockDebugItem }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-600 font-mono">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${KIND_COLORS[item.blockKind] ?? "bg-slate-500/60"}`}
      />
      <span className="text-slate-500">debug</span>
      <span className="text-slate-400">{item.blockName}</span>
      <span className="text-slate-700">({item.blockKind})</span>
      {item.payload.model && (
        <span className="text-purple-500/70 truncate">{item.payload.model}</span>
      )}
      {item.payload.modelOutput !== undefined && (
        <span className="text-amber-500/70 truncate" title={item.payload.modelOutput}>
          model-visible: {item.payload.modelOutput}
        </span>
      )}
    </div>
  );
}
