/**
 * Central item renderer with tier-based progressive disclosure.
 *
 * Tier 1 (always visible): message, error — rendered in chat-style layout.
 * Tier 2 (collapsed summary, expandable): block_output, reasoning, component,
 *         container, step_error, status.
 * Tier 3 (debug-only): context, state_change, resource_change.
 */
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
import { BlockToolOutputItemView } from "./block-tool-output-item";
import { RouterDecisionItemView } from "./router-decision-item";
import { useDebug } from "@/context/debug-context";
import { useSelection } from "@/context/selection-context";
import { DebugOverlay } from "./debug-overlay";
import { cn } from "@/lib/utils";

type ItemRendererProps = {
  item: OutputItem;
  sequenceNumber?: number;
};

const TIER_1_TYPES = new Set(["message", "error"]);
const TIER_3_TYPES = new Set(["context", "state_change", "resource_change"]);

export const ItemRenderer = memo(function ItemRenderer({ item, sequenceNumber }: ItemRendererProps) {
  const { isDebugMode } = useDebug();
  const { selectedItemId, selectItem } = useSelection();
  const isSelected = selectedItemId === item.id;

  const isTier3 = TIER_3_TYPES.has(item.type);
  if (isTier3 && !isDebugMode) {
    return null;
  }

  const isTier1 = TIER_1_TYPES.has(item.type);
  const isMessage = item.type === "message";
  const isUserMessage = isMessage && (item as { role: string }).role === "user";

  const handleClick = () => selectItem(item.id, item);

  if (isTier1) {
    return (
      <div
        className={cn(
          "relative cursor-pointer",
          isMessage ? "px-4 py-2" : "px-4 py-1",
          isSelected && "ring-1 ring-inset ring-green-500/40",
        )}
        onClick={handleClick}
      >
        {isDebugMode && (
          <DebugMeta item={item} sequenceNumber={sequenceNumber} />
        )}
        <ItemContent item={item} />
        {isDebugMode && <DebugOverlay item={item} />}
      </div>
    );
  }

  if (isTier3) {
    return (
      <div
        className={cn(
          "relative cursor-pointer px-4 py-0.5 opacity-40 hover:opacity-70",
          isSelected && "ring-1 ring-inset ring-green-500/40 opacity-70",
        )}
        onClick={handleClick}
      >
        {isDebugMode && (
          <DebugMeta item={item} sequenceNumber={sequenceNumber} />
        )}
        <ItemContent item={item} />
        {isDebugMode && <DebugOverlay item={item} />}
      </div>
    );
  }

  // Tier 2: collapsed/expandable items
  return (
    <div
      className={cn(
        "relative cursor-pointer px-4 py-0.5",
        "hover:bg-slate-800/20",
        isSelected && "bg-slate-800/30 ring-1 ring-inset ring-green-500/40",
      )}
      onClick={handleClick}
    >
      {isDebugMode && (
        <DebugMeta item={item} sequenceNumber={sequenceNumber} />
      )}
      <ItemContent item={item} />
      {isDebugMode && <DebugOverlay item={item} />}
    </div>
  );
});

function DebugMeta({ item, sequenceNumber }: { item: OutputItem; sequenceNumber?: number }) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-slate-600 font-mono mb-0.5">
      {sequenceNumber !== undefined && <span>#{sequenceNumber}</span>}
      <span>{item.type}</span>
      <span>{item.provenance.blockName}</span>
      <span>{item.provenance.blockInstanceId.slice(0, 12)}</span>
      {item.provenance.attempt && item.provenance.attempt > 1 && (
        <span>attempt:{item.provenance.attempt}</span>
      )}
    </div>
  );
}

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
    case "block_tool_output":
      return <BlockToolOutputItemView item={item} />;
    case "router_decision":
      return <RouterDecisionItemView item={item} />;
    default:
      return <div className="text-xs text-slate-500">Unknown item type: {(item as OutputItem).type}</div>;
  }
}
