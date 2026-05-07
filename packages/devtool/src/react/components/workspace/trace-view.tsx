import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { BlockTraceItem, OutputItem } from "@flow-state-dev/core/items";
import type { DevtoolItem } from "../../lib/item-types";
import { ChevronDown, ChevronRight, Clock, Minus, Inbox } from "lucide-react";
import type { TraceNode } from "../../lib/trace-tree";
import { buildTraceTree } from "../../lib/trace-tree";
import type { RequestGroup } from "./stream-view";
import { StatusBadge } from "../shared/status-badge";
import { KindIndicator } from "../shared/kind-indicator";
import { useSelection } from "../../context/selection-context";
import { useDebug } from "../../context/debug-context";
import { EmptyState } from "../shared/empty-state";
import { cn } from "../../lib/utils";

type TraceViewProps = {
  requestGroups: RequestGroup[];
};

export function TraceView({ requestGroups }: TraceViewProps) {
  const { selectedItemId } = useSelection();
  const { traceItemsVisible, toggleTraceItemsVisible } = useDebug();
  // Manual overrides from user clicks. `undefined` = no override (use computed).
  const [manualExpand, setManualExpand] = useState<Record<string, boolean>>({});
  // Track which request was last active so it stays expanded after completion.
  const [lastActiveId, setLastActiveId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeNodeRef = useRef<HTMLDivElement>(null);

  // Stable chronological ordering — sort requestGroups by startedAt before
  // building the tree so completed requests don't jump position on API refresh.
  const sortedTree = useMemo(() => {
    const sorted = [...requestGroups].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    return buildTraceTree(sorted);
  }, [requestGroups]);

  // Determine active request IDs.
  const activeRequestIds = useMemo(
    () => new Set(
      sortedTree
        .filter((n) => n.status === "in_progress" || n.status === "finishing")
        .map((n) => n.id)
    ),
    [sortedTree],
  );

  // IDs of requests that should have their full tree expanded (active + last-active).
  const expandedRequestIds = useMemo(() => {
    const ids = new Set(activeRequestIds);
    if (lastActiveId) ids.add(lastActiveId);
    return ids;
  }, [activeRequestIds, lastActiveId]);

  // Update last-active tracker.
  useEffect(() => {
    for (let i = sortedTree.length - 1; i >= 0; i--) {
      if (activeRequestIds.has(sortedTree[i].id)) {
        setLastActiveId(sortedTree[i].id);
        break;
      }
    }
  }, [sortedTree, activeRequestIds]);

  // Check if a selected item lives inside a given request node.
  const selectionInNode = useCallback(
    (node: TraceNode): boolean => {
      if (!selectedItemId) return false;
      const search = (n: TraceNode): boolean => {
        if (n.item?.id === selectedItemId) return true;
        if (n.traceItem?.id === selectedItemId) return true;
        return n.children.some(search);
      };
      return search(node);
    },
    [selectedItemId],
  );

  // Computed expansion.
  // Rules:
  //   1. Active requests (and all their children) → always expanded
  //   2. Last-active request (and all children) → stays expanded after completion
  //   3. Others → collapsed, UNLESS they contain the selected item
  const shouldExpand = useCallback(
    (node: TraceNode, parentRequestExpanded: boolean): boolean => {
      // Manual override takes precedence.
      if (manualExpand[node.id] !== undefined) return manualExpand[node.id];

      if (node.type === "request") {
        if (expandedRequestIds.has(node.id)) return true;
        if (selectionInNode(node)) return true;
        return false;
      }

      // Block nodes: expand when parent request is in the expanded set.
      if (parentRequestExpanded) return true;
      return false;
    },
    [manualExpand, expandedRequestIds, selectionInNode],
  );

  const toggleNode = useCallback((nodeId: string, currentlyExpanded: boolean) => {
    setManualExpand((prev) => ({ ...prev, [nodeId]: !currentlyExpanded }));
  }, []);

  // Clear manual overrides when active request changes so computed rules take over.
  useEffect(() => {
    if (activeRequestIds.size > 0) {
      setManualExpand({});
    }
  }, [activeRequestIds]);

  // Auto-scroll to keep the active trace in view.
  useEffect(() => {
    if (activeNodeRef.current) {
      activeNodeRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [sortedTree, activeRequestIds]);

  if (sortedTree.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-8 w-8" />}
        message="No requests yet. Send an action to get started."
        className="h-full"
      />
    );
  }

  return (
    <div className="flex flex-col h-full select-none">
      <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-slate-800/50">
        <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={traceItemsVisible}
            onChange={toggleTraceItemsVisible}
            className="h-3 w-3 rounded border-slate-600 bg-slate-800"
          />
          Show trace items
        </label>
      </div>
      <div ref={scrollContainerRef} className="overflow-auto flex-1">
        {sortedTree.map((node, index) => (
          <TraceNodeView
            key={node.id}
            node={node}
            depth={0}
            index={index + 1}
            shouldExpand={shouldExpand}
            parentRequestExpanded={false}
            toggleNode={toggleNode}
            isActive={activeRequestIds.has(node.id)}
            activeNodeRef={activeNodeRef}
            traceItemsVisible={traceItemsVisible}
          />
        ))}
      </div>
    </div>
  );
}

// Types that are always cosmetic in the tree — their payloads show up in
// the block detail sidebar (or other surfaces). Hidden from the trace
// tree unless the user flips "Show trace items" on.
const HIDDEN_TRACE_ITEM_TYPES = new Set([
  "state_snapshot",
  "state_change",
  "resource_change",
  "router_decision",
  "block_trace",
]);

function TraceNodeView({
  node,
  depth,
  index,
  shouldExpand,
  parentRequestExpanded,
  toggleNode,
  isActive,
  activeNodeRef,
  traceItemsVisible,
}: {
  node: TraceNode;
  depth: number;
  index?: number;
  shouldExpand: (node: TraceNode, parentRequestExpanded: boolean) => boolean;
  parentRequestExpanded: boolean;
  toggleNode: (id: string, currentlyExpanded: boolean) => void;
  isActive?: boolean;
  activeNodeRef?: React.RefObject<HTMLDivElement | null>;
  traceItemsVisible: boolean;
}) {
  const { selectedItemId, selectItem, selectedBlockNode, selectBlock } = useSelection();
  const { isDebugMode } = useDebug();
  const isExpanded = shouldExpand(node, parentRequestExpanded);
  // Children actually rendered — filter out hidden trace item rows unless
  // the user has opted in. Block children and request children always show.
  const visibleChildren = traceItemsVisible
    ? node.children
    : node.children.filter((child) => {
        if (child.type !== "item") return true;
        const itemType = child.item?.type;
        return itemType === undefined || !HIDDEN_TRACE_ITEM_TYPES.has(itemType);
      });
  const hasChildren = visibleChildren.length > 0;

  if (node.type === "request") {
    return (
      <div ref={isActive ? activeNodeRef : undefined}>
        <button
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-slate-800/30"
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={() => toggleNode(node.id, isExpanded)}
        >
          {hasChildren &&
            (isExpanded ? <ChevronDown className="h-3 w-3 text-slate-500" /> : <ChevronRight className="h-3 w-3 text-slate-500" />)}
          {index !== undefined && (
            <span className="text-[10px] font-mono text-slate-600">#{index}</span>
          )}
          <span className="text-xs text-slate-300">{node.action}</span>
          {node.status && <StatusBadge status={node.status} />}
          <span className="flex-1" />
          {node.duration !== undefined && (
            <span className="text-[10px] font-mono text-slate-500">{(node.duration / 1000).toFixed(1)}s</span>
          )}
        </button>
        {isExpanded &&
          visibleChildren.map((child) => (
            <TraceNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              shouldExpand={shouldExpand}
              parentRequestExpanded={isExpanded}
              toggleNode={toggleNode}
              traceItemsVisible={traceItemsVisible}
            />
          ))}
      </div>
    );
  }

  if (node.type === "block") {
    const isBlockSelected = selectedBlockNode?.id === node.id;
    const traceError =
      node.traceItem?.type === "block_trace" && node.traceItem.status === "failed"
        ? node.traceItem.error?.message
        : undefined;

    // Chevron toggles expansion; clicking the row body selects the block.
    // Keeping these separate means you can inspect a block without
    // collapsing its child list.
    const handleChevronClick = (event: React.MouseEvent) => {
      event.stopPropagation();
      toggleNode(node.id, isExpanded);
    };
    const handleRowClick = () => selectBlock(node);

    return (
      <div>
        <div
          className={cn(
            "flex w-full items-center gap-1.5 py-1 text-left hover:bg-slate-800/30 cursor-pointer",
            isBlockSelected && "bg-slate-800/50 border-l-2 border-green-500",
          )}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={handleRowClick}
        >
          {hasChildren ? (
            <button
              type="button"
              className="p-0.5 -m-0.5 hover:text-slate-300"
              aria-label={isExpanded ? "Collapse" : "Expand"}
              onClick={handleChevronClick}
            >
              {isExpanded
                ? <ChevronDown className="h-3 w-3 text-slate-500" />
                : <ChevronRight className="h-3 w-3 text-slate-500" />}
            </button>
          ) : (
            <span className="w-3" />
          )}
          {node.blockKind && <KindIndicator kind={node.blockKind} />}
          <span className="text-xs text-slate-300">{node.blockName}</span>
          {node.phase === "work" && <BackgroundBadge />}
          {traceError && (
            <span
              className="text-[11px] text-red-400/80 truncate max-w-[20rem]"
              title={traceError}
            >
              {traceError}
            </span>
          )}
          {(() => {
            const trace = node.traceItem as BlockTraceItem | undefined;
            const hasGenerator = trace?.generator !== undefined;
            const hasConnected = trace?.input?.connected !== undefined;
            if (!hasGenerator && !hasConnected) return null;
            return (
              <span
                className="text-[10px] font-mono text-purple-400/70 px-1 rounded border border-purple-800/40"
                title={trace?.generator?.prompt ? "Resolved prompt captured" : "Connected input captured"}
              >
                D
              </span>
            );
          })()}
          {node.stateSnapshots && node.stateSnapshots.length > 0 && (
            <span
              className="text-[10px] font-mono text-amber-500/70 px-1 rounded border border-amber-800/40"
              title={`${node.stateSnapshots.length} state snapshot${node.stateSnapshots.length === 1 ? "" : "s"}`}
            >
              S
            </span>
          )}
          {node.blockStatus && <StatusBadge status={node.blockStatus} />}
          <span className="flex-1" />
          {isDebugMode && node.blockInstanceId && (
            <span className="text-[10px] font-mono text-slate-600 mr-1">{node.blockInstanceId.slice(0, 8)}</span>
          )}
          {node.blockDuration !== undefined && (
            <span className="text-[10px] font-mono text-slate-500 flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {node.blockDuration}ms
            </span>
          )}
        </div>
        {isExpanded &&
          visibleChildren.map((child) => (
            <TraceNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              shouldExpand={shouldExpand}
              parentRequestExpanded={parentRequestExpanded}
              toggleNode={toggleNode}
              traceItemsVisible={traceItemsVisible}
            />
          ))}
      </div>
    );
  }

  if (node.type === "item" && node.item) {
    const item = node.item;
    const isSelected = selectedItemId === item.id;
    const icon = getItemIcon(item.type);
    const preview = getItemPreview(item);

    return (
      <button
        className={cn(
          "flex w-full items-center gap-1.5 py-0.5 text-left hover:bg-slate-800/30",
          isSelected && "bg-slate-800/50 border-l-2 border-green-500",
        )}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
        onClick={() => selectItem(item.id, item)}
      >
        <Minus className="h-2.5 w-2.5 text-slate-700 shrink-0" />
        <span className="text-[10px] shrink-0">{icon}</span>
        <span className="text-xs text-slate-400 truncate flex-1">{preview}</span>
        <span className="text-[10px] text-slate-600 shrink-0">{item.type}</span>
      </button>
    );
  }

  return null;
}

/** Visual marker for blocks dispatched onto the work queue. */
function BackgroundBadge() {
  return (
    <span
      className="text-[10px] font-mono text-sky-400/80 px-1 rounded border border-sky-700/50"
      title="Background sidechain — dispatched via .work() / .workIf() / .forEachBackground()"
    >
      BG
    </span>
  );
}

function getItemIcon(type: string): string {
  const icons: Record<string, string> = {
    message: "💬",
    reasoning: "🧠",
    block_output: "{}",
    error: "❌",
    status: "○",
    component: "🧩",
    container: "📦",
    context: "👁",
    state_change: "Δ",
    resource_change: "📄",
    block_tool_output: "{}",
    router_decision: "🔀",
    source: "🔗",
    state_snapshot: "📊",
  };
  return icons[type] ?? "?";
}

function getItemPreview(item: DevtoolItem): string {
  switch (item.type) {
    case "message": {
      const text = item.content
        .map((c) => ("text" in c ? (c as { text: string }).text : ""))
        .join("");
      return text.slice(0, 60) + (text.length > 60 ? "..." : "");
    }
    case "error":
      return item.message;
    case "status": {
      // Structural status items from the sequencer's auto-await (FIX-369)
      // arrive with an empty `message` and only a `backgroundTasks` count.
      // Synthesize a label so the trace row isn't blank. See also
      // `StatusItemView` in components/items/status-item.tsx — same contract.
      if (item.message) return item.message;
      if (typeof item.backgroundTasks === "number") {
        return item.backgroundTasks === 0
          ? "background work complete"
          : `background tasks: ${item.backgroundTasks} pending`;
      }
      return "";
    }
    case "block_trace":
      return item.blockName + (item.toolCall ? ` → ${item.toolCall.callId}` : "");
    case "reasoning": {
      const rText = item.summary
        .map((c) => ("text" in c ? (c as { text: string }).text : ""))
        .join("");
      return rText.slice(0, 60) + (rText.length > 60 ? "..." : "");
    }
    case "component":
      return item.component;
    case "container":
      return item.blockName + (item.label ? ` (${item.label})` : "");
    case "state_change":
      return `${item.scope}.${item.path ?? ""} ${item.operation}`;
    case "resource_change":
      return `${item.resourcePath} ${item.changeType}`;
    case "tool_output":
      return `${item.toolCall.name}(${item.toolCall.arguments.slice(0, 40)})`;
    case "router_decision":
      return `${item.routerName} → ${item.selectedRoute}`;
    case "source":
      return (item as any).title ?? (item as any).url ?? "source";
    case "state_snapshot":
      return `${item.provenance.blockName} → ${item.stepName === "__initial__" ? "init" : item.stepName}`;
    default:
      return "";
  }
}
