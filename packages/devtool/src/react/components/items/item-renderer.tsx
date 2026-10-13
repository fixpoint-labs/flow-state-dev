/**
 * Central item renderer for stream view.
 *
 * Chat-first: messages and errors render inline. Tool calls and reasoning
 * are compact collapsibles. Clicking any item opens detail in the sidebar.
 * Debug overlays only appear in debug mode.
 */
import { memo } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { DevtoolItem } from "../../lib/item-types";
import { MessageItemView } from "./message-item";
import { ReasoningItemView } from "./reasoning-item";
import { BlockTraceItemView } from "./block-output-item";
import { ErrorItemView } from "./error-item";
import { StatusItemView } from "./status-item";
import { ComponentItemView } from "./component-item";
import { ContainerItemView } from "./container-item";
import { StateChangeItemView } from "./state-change-item";
import { ResourceChangeItemView } from "./resource-change-item";
import { ToolOutputItemView } from "./block-tool-output-item";
import { RouterDecisionItemView } from "./router-decision-item";
import { SourceItemView } from "./source-item";
import { SuspensionItemView } from "./suspension-item";
import { SuspensionResumeItemView } from "./suspension-resume-item";
import { ContinuationItemView } from "./continuation-item";
// FIX-573: BlockDebugItemView is gone with the unified block_trace lifecycle.
import { useDebug } from "../../context/debug-context";
import { useSelection } from "../../context/selection-context";
import { DebugOverlay } from "./debug-overlay";
import { cn } from "../../lib/utils";

type ItemRendererProps = {
  item: DevtoolItem;
};

const TIER_3_TYPES = new Set(["state_change", "resource_change", "state_snapshot"]);

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
          isSelected && "ring-1 ring-inset ring-fs-blue bg-fs-blue/8",
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
          isSelected && "ring-1 ring-inset ring-fs-blue opacity-70",
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
        isSelected && "bg-fs-blue/8 shadow-[inset_2px_0_0_var(--fs-blue)]",
      )}
      onClick={handleClick}
    >
      <ItemContent item={item} />
      {isDebugMode && <DebugOverlay item={item} />}
    </div>
  );
});

function ItemContent({ item }: { item: DevtoolItem }) {
  switch (item.type) {
    case "message":
      return <MessageItemView item={item} />;
    case "reasoning":
      return <ReasoningItemView item={item} />;
    case "block_trace":
      return <BlockTraceItemView item={item} />;
    case "error":
      return <ErrorItemView item={item} />;
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
    case "tool_output":
      return <ToolOutputItemView item={item} />;
    case "router_decision":
      return <RouterDecisionItemView item={item} />;
    case "source":
      return <SourceItemView item={item} />;
    case "suspension":
      return <SuspensionItemView item={item} />;
    case "suspension_resume":
      return <SuspensionResumeItemView item={item} />;
    case "continuation":
      return <ContinuationItemView item={item} />;
    case "state_snapshot":
      return <StateSnapshotItemView item={item} />;
    default:
      return null;
  }
}

function StateSnapshotItemView({ item }: { item: DevtoolItem & { type: "state_snapshot" } }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-fs-ink4 font-fs-mono">
      <span className="inline-block size-1.5 bg-fs-ink3 shrink-0" />
      <span className="text-fs-ink3">state</span>
      <span className="text-fs-ink3">{item.provenance.blockName}</span>
      <span className="text-fs-ink4">{item.stepName === "__initial__" ? "init" : item.stepName}</span>
    </div>
  );
}
