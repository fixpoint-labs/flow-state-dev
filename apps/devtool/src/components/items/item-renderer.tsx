/**
 * Central item renderer for stream view.
 *
 * Chat-first: messages and errors render inline. Tool calls and reasoning
 * are compact collapsibles. Clicking any item opens detail in the sidebar.
 * Debug overlays only appear in debug mode.
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
import { SourceItemView } from "./source-item";
import { BlockDebugItemView } from "./block-debug-item";
import { useDebug } from "@/context/debug-context";
import { useSelection } from "@/context/selection-context";
import { DebugOverlay } from "./debug-overlay";
import { cn } from "@/lib/utils";

type ItemRendererProps = {
  item: OutputItem;
};

const TIER_3_TYPES = new Set(["state_change", "resource_change", "state_snapshot", "block_debug"]);

export const ItemRenderer = memo(function ItemRenderer({ item }: ItemRendererProps) {
  const { isDebugMode } = useDebug();
  const { selectedItemId, selectItem } = useSelection();
  const isSelected = selectedItemId === item.id;

  const isTier3 = TIER_3_TYPES.has(item.type);
  if (isTier3 && !isDebugMode) return null;

  const isMessage = item.type === "message";
  const isError = item.type === "error";
  const handleClick = () => selectItem(item.id, item);

  // Messages and errors: primary content, no background hover.
  if (isMessage || isError) {
    return (
      <div
        className={cn(
          "relative cursor-pointer",
          isMessage ? "py-1" : "py-0.5",
          isSelected && "ring-1 ring-inset ring-green-500/40 rounded",
        )}
        onClick={handleClick}
      >
        <ItemContent item={item} />
        {isDebugMode && <DebugOverlay item={item} />}
      </div>
    );
  }

  // Tier 3: debug-only, dimmed.
  if (isTier3) {
    return (
      <div
        className={cn(
          "relative cursor-pointer py-0.5 opacity-40 hover:opacity-70",
          isSelected && "ring-1 ring-inset ring-green-500/40 opacity-70",
        )}
        onClick={handleClick}
      >
        <ItemContent item={item} />
        {isDebugMode && <DebugOverlay item={item} />}
      </div>
    );
  }

  // Everything else (reasoning, tool calls, components, etc.): compact inline.
  return (
    <div
      className={cn(
        "relative cursor-pointer py-0.5",
        isSelected && "bg-slate-800/30 ring-1 ring-inset ring-green-500/40 rounded",
      )}
      onClick={handleClick}
    >
      <ItemContent item={item} />
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
    case "state_change":
      return <StateChangeItemView item={item} />;
    case "resource_change":
      return <ResourceChangeItemView item={item} />;
    case "block_tool_output":
      return <BlockToolOutputItemView item={item} />;
    case "router_decision":
      return <RouterDecisionItemView item={item} />;
    case "source":
      return <SourceItemView item={item} />;
    case "state_snapshot":
      return <StateSnapshotItemView item={item} />;
    case "block_debug":
      return <BlockDebugItemView item={item} />;
    default:
      return null;
  }
}

function StateSnapshotItemView({ item }: { item: OutputItem & { type: "state_snapshot" } }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-600 font-mono">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500/60 shrink-0" />
      <span className="text-amber-600/80">state</span>
      <span className="text-slate-500">{item.provenance.blockName}</span>
      <span className="text-slate-700">{item.stepName === "__initial__" ? "init" : item.stepName}</span>
    </div>
  );
}
