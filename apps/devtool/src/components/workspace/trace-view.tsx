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
  const tree = useMemo(() => buildTraceTree(requestGroups), [requestGroups]);
  const [expandState, setExpandState] = useState<Record<string, boolean>>({});
  const prevLastIdRef = useRef<string | null>(null);

  // Auto-expand new nodes in the latest request when it changes.
  useEffect(() => {
    if (tree.length === 0) return;
    const lastNode = tree[tree.length - 1];
    if (lastNode.id === prevLastIdRef.current) return;
    prevLastIdRef.current = lastNode.id;

    // Expand the latest request and all its block children.
    const autoExpand: Record<string, boolean> = { [lastNode.id]: true };
    const expandChildren = (node: TraceNode) => {
      for (const child of node.children) {
        if (child.type === "block") {
          autoExpand[child.id] = true;
          expandChildren(child);
        }
      }
    };
    expandChildren(lastNode);

    setExpandState((prev) => ({ ...prev, ...autoExpand }));
  }, [tree]);

  const toggleNode = useCallback((nodeId: string) => {
    setExpandState((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }));
  }, []);

  if (tree.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-8 w-8" />}
        message="No requests yet. Send an action to get started."
        className="h-full"
      />
    );
  }

  return (
    <div className="overflow-auto h-full">
      {tree.map((node) => (
        <TraceNodeView
          key={node.id}
          node={node}
          depth={0}
          expandState={expandState}
          toggleNode={toggleNode}
        />
      ))}
    </div>
  );
}

function TraceNodeView({
  node,
  depth,
  expandState,
  toggleNode,
}: {
  node: TraceNode;
  depth: number;
  expandState: Record<string, boolean>;
  toggleNode: (id: string) => void;
}) {
  const { selectedItemId, selectItem } = useSelection();
  const { isDebugMode } = useDebug();
  const isExpanded = expandState[node.id] ?? node.isExpanded;
  const hasChildren = node.children.length > 0;

  if (node.type === "request") {
    return (
      <div>
        <button
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-slate-800/30"
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
          onClick={() => toggleNode(node.id)}
        >
          {hasChildren &&
            (isExpanded ? <ChevronDown className="h-3 w-3 text-slate-500" /> : <ChevronRight className="h-3 w-3 text-slate-500" />)}
          <span className="text-[10px] font-mono text-slate-500">{node.requestId?.slice(0, 10)}</span>
          <span className="text-xs text-slate-300">{node.action}</span>
          {node.status && <StatusBadge status={node.status} />}
          <span className="flex-1" />
          {node.duration !== undefined && (
            <span className="text-[10px] font-mono text-slate-500">{(node.duration / 1000).toFixed(1)}s</span>
          )}
        </button>
        {isExpanded &&
          node.children.map((child) => (
            <TraceNodeView key={child.id} node={child} depth={depth + 1} expandState={expandState} toggleNode={toggleNode} />
          ))}
      </div>
    );
  }

  if (node.type === "block") {
    const isBlockSelected = node.traceItem ? selectedItemId === node.traceItem.id : false;

    const handleBlockClick = () => {
      toggleNode(node.id);
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
            <TraceNodeView key={child.id} node={child} depth={depth + 1} expandState={expandState} toggleNode={toggleNode} />
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
    default:
      return "";
  }
}
