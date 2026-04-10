import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { ChevronDown, ChevronRight, Clock, Minus, Inbox } from "lucide-react";
import type { TraceNode } from "@/lib/trace-tree";
import { buildTraceTree } from "@/lib/trace-tree";
import type { RequestGroup } from "./stream-view";
import { StatusBadge } from "@/components/shared/status-badge";
import { KindIndicator } from "@/components/shared/kind-indicator";
import { useSelection } from "@/context/selection-context";
import { useDebug } from "@/context/debug-context";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";

type TraceViewProps = {
  requestGroups: RequestGroup[];
};

export function TraceView({ requestGroups }: TraceViewProps) {
  const { selectedItemId } = useSelection();
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
    <div ref={scrollContainerRef} className="overflow-auto h-full">
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
        />
      ))}
    </div>
  );
}

function TraceNodeView({
  node,
  depth,
  index,
  shouldExpand,
  parentRequestExpanded,
  toggleNode,
  isActive,
  activeNodeRef,
}: {
  node: TraceNode;
  depth: number;
  index?: number;
  shouldExpand: (node: TraceNode, parentRequestExpanded: boolean) => boolean;
  parentRequestExpanded: boolean;
  toggleNode: (id: string, currentlyExpanded: boolean) => void;
  isActive?: boolean;
  activeNodeRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const { selectedItemId, selectItem } = useSelection();
  const { isDebugMode } = useDebug();
  const isExpanded = shouldExpand(node, parentRequestExpanded);
  const hasChildren = node.children.length > 0;

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
          node.children.map((child) => (
            <TraceNodeView key={child.id} node={child} depth={depth + 1} shouldExpand={shouldExpand} parentRequestExpanded={isExpanded} toggleNode={toggleNode} />
          ))}
      </div>
    );
  }

  if (node.type === "block") {
    const isBlockSelected = node.traceItem ? selectedItemId === node.traceItem.id : false;
    const traceError =
      node.traceItem?.type === "block_output" && node.traceItem.status === "failed"
        ? node.traceItem.error?.message
        : undefined;

    const handleBlockClick = () => {
      toggleNode(node.id, isExpanded);
      if (node.traceItem) {
        selectItem(node.traceItem.id, node.traceItem);
      }
    };

    return (
      <div>
        <button
          className={cn(
            "flex w-full items-center gap-1.5 py-1 text-left hover:bg-slate-800/30",
            isBlockSelected && "bg-slate-800/50 border-l-2 border-green-500",
          )}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={handleBlockClick}
        >
          {hasChildren &&
            (isExpanded ? <ChevronDown className="h-3 w-3 text-slate-500" /> : <ChevronRight className="h-3 w-3 text-slate-500" />)}
          {!hasChildren && <span className="w-3" />}
          {node.blockKind && <KindIndicator kind={node.blockKind} />}
          <span className="text-xs text-slate-300">{node.blockName}</span>
          {traceError && (
            <span
              className="text-[11px] text-red-400/80 truncate max-w-[20rem]"
              title={traceError}
            >
              {traceError}
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
        </button>
        {isExpanded &&
          node.children.map((child) => (
            <TraceNodeView key={child.id} node={child} depth={depth + 1} shouldExpand={shouldExpand} parentRequestExpanded={parentRequestExpanded} toggleNode={toggleNode} />
          ))}
      </div>
    );
  }

  if (node.type === "item" && node.item) {
    const item = node.item;
    const isSelected = selectedItemId === item.id;
    const isContext = item.type === "context";

    if (isContext && !isDebugMode) return null;

    const icon = getItemIcon(item.type);
    const preview = getItemPreview(item);

    return (
      <button
        className={cn(
          "flex w-full items-center gap-1.5 py-0.5 text-left hover:bg-slate-800/30",
          isSelected && "bg-slate-800/50 border-l-2 border-green-500",
          isContext && "opacity-50",
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

function getItemIcon(type: string): string {
  const icons: Record<string, string> = {
    message: "💬",
    reasoning: "🧠",
    block_output: "{}",
    error: "❌",
    step_error: "⚠️",
    status: "○",
    component: "🧩",
    container: "📦",
    context: "👁",
    state_change: "Δ",
    resource_change: "📄",
    block_tool_output: "{}",
    router_decision: "🔀",
    source: "🔗",
  };
  return icons[type] ?? "?";
}

function getItemPreview(item: OutputItem): string {
  switch (item.type) {
    case "message": {
      const text = item.content
        .map((c) => ("text" in c ? (c as { text: string }).text : ""))
        .join("");
      return text.slice(0, 60) + (text.length > 60 ? "..." : "");
    }
    case "error":
      return item.message;
    case "step_error":
      return item.message;
    case "status":
      return item.message;
    case "block_output":
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
    case "context":
      return item.text.slice(0, 60);
    case "state_change":
      return `${item.scope}.${item.path ?? ""} ${item.operation}`;
    case "resource_change":
      return `${item.resourcePath} ${item.changeType}`;
    case "block_tool_output":
      return `${item.toolCall.name}(${item.toolCall.arguments.slice(0, 40)})`;
    case "router_decision":
      return `${item.routerName} → ${item.selectedRoute}`;
    case "source":
      return (item as any).title ?? (item as any).url ?? "source";
    default:
      return "";
  }
}
