import { memo } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { MessageItemView } from "./message-item";
import { ReasoningItemView } from "./reasoning-item";
import { BlockOutputItemView } from "./block-output-item";
import { ErrorItemView } from "./error-item";
import { StepErrorItemView } from "./step-error-item";
import { StatusItemView } from "./status-item";
import { ComponentItemView } from "./component-item";
import { ContainerItemView } from "./container-item";
import { ContextItemView } from "./context-item";
import { StateChangeItemView } from "./state-change-item";
import { ResourceChangeItemView } from "./resource-change-item";
import { useDebug } from "@/context/debug-context";
import { useSelection } from "@/context/selection-context";
import { DebugOverlay } from "./debug-overlay";
import { cn } from "@/lib/utils";

type ItemRendererProps = {
  item: OutputItem;
  sequenceNumber?: number;
};

export const ItemRenderer = memo(function ItemRenderer({ item, sequenceNumber }: ItemRendererProps) {
  const { isDebugMode } = useDebug();
  const { selectedItemId, selectItem } = useSelection();
  const isSelected = selectedItemId === item.id;

  if (item.type === "context" && !isDebugMode) {
    return null;
  }

  const handleClick = () => selectItem(item.id, item);

  return (
    <div
      className={cn(
        "group relative px-3 py-1.5 cursor-pointer hover:bg-slate-800/30",
        isSelected && "bg-slate-800/50 border-l-2 border-green-500",
        item.type === "context" && "opacity-50",
      )}
      onClick={handleClick}
    >
      <div className="flex items-start gap-2">
        {isDebugMode && sequenceNumber !== undefined && (
          <span className="shrink-0 text-[10px] font-mono text-slate-600 mt-0.5">
            #{sequenceNumber}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {isDebugMode && (
            <div className="text-[10px] text-slate-600 font-mono mb-0.5">
              {item.type} | {item.provenance.blockName} | {item.provenance.blockInstanceId.slice(0, 12)}
              {item.provenance.attempt && item.provenance.attempt > 1 ? ` | attempt:${item.provenance.attempt}` : ""}
            </div>
          )}
          <ItemContent item={item} />
        </div>
      </div>
      {isDebugMode && <DebugOverlay item={item} />}
    </div>
  );
});

function ItemContent({ item }: { item: OutputItem }) {
  switch (item.type) {
    case "message":
      return <MessageItemView item={item} />;
    case "reasoning":
      return <ReasoningItemView item={item} />;
    case "block_output":
      return <BlockOutputItemView item={item} />;
    case "error":
      return <ErrorItemView item={item} />;
    case "step_error":
      return <StepErrorItemView item={item} />;
    case "status":
      return <StatusItemView item={item} />;
    case "component":
      return <ComponentItemView item={item} />;
    case "container":
      return <ContainerItemView item={item} />;
    case "context":
      return <ContextItemView item={item} />;
    case "state_change":
      return <StateChangeItemView item={item} />;
    case "resource_change":
      return <ResourceChangeItemView item={item} />;
    default:
      return <div className="text-xs text-slate-500">Unknown item type: {(item as OutputItem).type}</div>;
  }
}
