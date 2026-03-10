import type { ContainerItem } from "@flow-state-dev/core/items";
import { Package } from "lucide-react";

export function ContainerItemView({ item }: { item: ContainerItem }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-400">
      <Package className="h-3.5 w-3.5 shrink-0" />
      <span className="font-mono">{item.blockName}</span>
      {item.label && <span className="text-slate-500">({item.label})</span>}
    </div>
  );
}
