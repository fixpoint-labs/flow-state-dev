import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { BlockTraceItem, OutputItem, ItemLookup } from "@flow-state-dev/core/items";
import { sideChainTaskCount, sideChainTaskLabel } from "../../lib/side-chain-task-count";
import { resolveBlockValueInternal } from "@flow-state-dev/core/items/internal";
import type { DevtoolItem } from "../../lib/item-types";
import { ChevronDown, ChevronRight, Minus, Inbox } from "lucide-react";
import type { TraceNode } from "../../lib/trace-tree";
import { buildTraceTree } from "../../lib/trace-tree";
import type { RequestGroup } from "./stream-view";
import { statusSquareClass } from "./request-separator";
import { useSelection } from "../../context/selection-context";
import { useDebug } from "../../context/debug-context";
import { useTraceLookup } from "../../context/trace-context";
import { isInternalBlockValue } from "../shared/block-value-view";
import { EmptyState } from "../shared/empty-state";
import { cn, errorSummary } from "../../lib/utils";

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

  // Per-request timeline window (wall-clock ms) for the bar column. Spans
  // the request's own start/duration widened to cover every block's
  // start/duration, so a bar never falls outside its track. Requests whose
  // blocks carry no `startedAt` get no window — the bar column stays empty
  // rather than drawing positions the data doesn't have.
  const timelineWindows = useMemo(() => {
    const windows = new Map<string, TimelineWindow>();
    const groupById = new Map(requestGroups.map((g) => [`req-${g.requestId}`, g]));
    for (const requestNode of sortedTree) {
      const group = groupById.get(requestNode.id);
      let start = Number.POSITIVE_INFINITY;
      let end = Number.NEGATIVE_INFINITY;
      let timedBlocks = 0;
      const visit = (n: TraceNode) => {
        if (n.type === "block" && n.blockStartedAt !== undefined) {
          timedBlocks += 1;
          start = Math.min(start, n.blockStartedAt);
          end = Math.max(end, blockEnd(n) ?? n.blockStartedAt);
        }
        n.children.forEach(visit);
      };
      requestNode.children.forEach(visit);
      if (timedBlocks === 0) continue;
      if (group?.startedAt !== undefined) {
        start = Math.min(start, group.startedAt);
        if (group.duration !== undefined) end = Math.max(end, group.startedAt + group.duration);
      }
      if (end > start) windows.set(requestNode.id, { start, total: end - start });
    }
    return windows;
  }, [sortedTree, requestGroups]);

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
    <div className="flex flex-col h-full select-none bg-fs-surface">
      <div className="border-b border-fs-ink/12 bg-fs-surface">
        <div className="flex items-center gap-3 px-[18px] pb-2 pt-2.5">
          <TraceLegend />
          <label className="ml-auto flex shrink-0 cursor-pointer select-none items-center gap-1.5 font-fs-mono text-[11px] font-medium text-fs-ink3 hover:text-fs-ink">
            <input
              type="checkbox"
              checked={traceItemsVisible}
              onChange={toggleTraceItemsVisible}
              className="size-3 accent-fs-blue focus-visible:ring-2 focus-visible:ring-fs-blue/40"
            />
            Show trace items
          </label>
        </div>
        <div className={cn(ROW_GRID, "pb-1.5 font-fs-mono text-[10px] font-medium tracking-[.12em] text-fs-ink4")}>
          <span className="pl-1.5">BLOCK</span>
          <span className="pr-3 text-right">TIME</span>
          <span>TIMELINE</span>
        </div>
      </div>
      <div ref={scrollContainerRef} className="overflow-auto flex-1 pb-5 pt-1">
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
            timeline={timelineWindows.get(node.id)}
          />
        ))}
      </div>
    </div>
  );
}

/** A request's wall-clock span, used to position each block's timeline bar. */
type TimelineWindow = { start: number; total: number };

/** Row grid shared by the column header and every tree row: block | time | timeline. */
const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_64px_220px] items-center pl-2 pr-[18px]";

/** Repeating 16px indent rule — one hairline per nesting level. */
const INDENT_GUIDES: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(90deg, transparent 0 13px, color-mix(in srgb, var(--fs-ink) 16%, transparent) 13px 14px, transparent 14px 16px)",
};

/** Quarter ticks behind every timeline track. */
const TRACK_TICKS: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(90deg, color-mix(in srgb, var(--fs-ink) 10%, transparent) 0 1px, transparent 1px 25%)",
};

/** Mono kind labels — kinds are told apart by text, not hue. */
const KIND_LABELS: Record<string, string> = {
  generator: "GEN",
  evaluator: "EVL",
  handler: "HDL",
  sequencer: "SEQ",
  router: "RTR",
};

/** Tag treatment for the small inline markers (iter, SC, D, S). */
const TAG = "shrink-0 border px-1 font-fs-mono text-[9.5px] font-medium uppercase tracking-[.08em]";

function blockEnd(node: TraceNode): number | undefined {
  if (node.blockCompletedAt !== undefined) return node.blockCompletedAt;
  if (node.blockStartedAt !== undefined && node.blockDuration !== undefined) {
    return node.blockStartedAt + node.blockDuration;
  }
  return undefined;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function TraceLegend() {
  const entry = "flex items-center gap-[5px]";
  return (
    <div className="flex h-4 min-w-0 flex-wrap gap-x-3.5 overflow-hidden whitespace-nowrap font-fs-mono text-[10.5px] font-medium leading-4 text-fs-ink3">
      <span className={entry}><span className="size-2 bg-fs-green" />ok</span>
      <span className={entry}><span className="size-2 bg-fs-blue" />active</span>
      <span className={entry}><span className="size-2 bg-fs-red" />error</span>
      <span className={entry}><span className="box-border size-2 border border-dashed border-fs-ink3" />skipped</span>
      <span className={entry}><span className="box-border h-[5px] w-3.5 border border-dashed border-fs-ink3" />side chain</span>
    </div>
  );
}

/** Square status glyph for a tree row. */
function StatusSquare({ status }: { status?: string }) {
  return (
    <span
      className={cn("inline-block size-2 shrink-0 box-border", statusSquareClass(status))}
      title={status}
    />
  );
}

/** Indent rail: one guide per nesting level. */
function IndentGuides({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return <span className="shrink-0 self-stretch" style={{ width: depth * 16, ...INDENT_GUIDES }} />;
}

/**
 * The timeline cell for a block row. Positioned by the block's own
 * start/duration inside its request's window; empty track when either is
 * unknown.
 */
function TimelineBar({
  node,
  depth,
  timeline,
}: {
  node: TraceNode;
  depth: number;
  timeline?: TimelineWindow;
}) {
  const started = node.blockStartedAt;
  const end = blockEnd(node) ?? (node.blockStatus === "in_progress" && timeline ? timeline.start + timeline.total : undefined);
  const hasBar = timeline !== undefined && started !== undefined && end !== undefined;
  const left = hasBar ? Math.min(100, Math.max(0, ((started - timeline.start) / timeline.total) * 100)) : 0;
  const width = hasBar ? Math.min(100 - left, Math.max(0.6, ((end - started) / timeline.total) * 100)) : 0;
  const isSideChain = node.phase === "sideChain";
  const barClass = node.blockStatus === "failed"
    ? isSideChain ? "border border-dashed border-fs-red" : "bg-fs-red"
    : isSideChain
      ? "border border-dashed border-fs-ink"
      : node.blockStatus === "in_progress"
        ? "bg-fs-blue"
        : node.blockKind === "generator"
          ? "bg-fs-ink"
          : depth < 2
            ? "bg-fs-ink/22"
            : "bg-fs-ink/50";
  return (
    <div className="relative h-3" style={TRACK_TICKS}>
      {hasBar && (
        <span
          className={cn("absolute top-[3px] box-border h-1.5", barClass)}
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      )}
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
  timeline,
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
  timeline?: TimelineWindow;
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
          className={cn(ROW_GRID, "min-h-7 w-full text-left hover:bg-fs-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fs-blue/40")}
          onClick={() => toggleNode(node.id, isExpanded)}
        >
          <span className="flex min-w-0 items-center gap-1.5 self-stretch">
            <IndentGuides depth={depth} />
            <span className="flex w-3.5 shrink-0 justify-center text-fs-ink3">
              {hasChildren &&
                (isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
            </span>
            <StatusSquare status={node.status} />
            {index !== undefined && (
              <span className="w-7 shrink-0 font-fs-mono text-[10px] font-medium tracking-[.04em] text-fs-ink4">#{index}</span>
            )}
            <span className="min-w-0 truncate font-fs-mono text-[12.5px] font-semibold text-fs-ink">{node.action}</span>
            {node.status && (
              <span
                className={cn(
                  "min-w-0 truncate font-fs-mono text-[10.5px] font-medium",
                  node.status === "failed" ? "text-fs-red" : "text-fs-ink4",
                )}
              >
                {node.status}
              </span>
            )}
          </span>
          <span className="pr-3 text-right font-fs-mono text-[11px] font-medium tabular-nums text-fs-ink3">
            {node.duration !== undefined ? `${(node.duration / 1000).toFixed(1)}s` : ""}
          </span>
          <div className="relative h-3" style={TRACK_TICKS}>
            {timeline !== undefined && <span className="absolute inset-x-0 top-[3px] h-1.5 bg-fs-ink/22" />}
          </div>
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
              timeline={timeline}
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
    const traceErrorSummary =
      node.traceItem?.type === "block_trace" && node.traceItem.status === "failed"
        ? errorSummary(node.traceItem.error?.details)
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
        {/* The row and its in/out preview are one target: hover, selection and click cover both. */}
        <div
          className={cn(
            "cursor-pointer hover:bg-fs-ink/5",
            isBlockSelected && "bg-fs-blue/8 shadow-[inset_2px_0_0_var(--fs-blue)]",
          )}
          onClick={handleRowClick}
        >
        <div className={cn(ROW_GRID, "min-h-7 w-full text-left")}>
          <div className="flex min-w-0 items-center gap-1.5 self-stretch">
            <IndentGuides depth={depth} />
            {hasChildren ? (
              <button
                type="button"
                className="flex w-3.5 shrink-0 justify-center text-fs-ink3 hover:text-fs-ink"
                aria-label={isExpanded ? "Collapse" : "Expand"}
                onClick={handleChevronClick}
              >
                {isExpanded
                  ? <ChevronDown className="h-3 w-3" />
                  : <ChevronRight className="h-3 w-3" />}
              </button>
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <StatusSquare status={node.blockStatus} />
            <span className="w-7 shrink-0 font-fs-mono text-[10px] font-medium tracking-[.04em] text-fs-ink4">
              {node.blockKind ? (KIND_LABELS[node.blockKind] ?? node.blockKind) : ""}
            </span>
            <span
              className={cn(
                "min-w-0 truncate font-fs-mono text-[12.5px] text-fs-ink",
                depth < 2 || node.blockKind === "generator" ? "font-semibold" : "font-medium",
              )}
            >
              {node.blockName}
            </span>
            {node.iterationIndex !== undefined && (
              <span
                className={cn(TAG, "border-fs-ink/45 text-fs-ink3")}
                title={`loopBack iteration ${node.iterationIndex}`}
              >
                iter {node.iterationIndex}
              </span>
            )}
            {node.phase === "sideChain" && <SideChainBadge />}
            {traceErrorSummary && (
              <span className={cn(TAG, "border-fs-red text-fs-red normal-case tracking-normal")}>
                {traceErrorSummary}
              </span>
            )}
            {traceError && (
              <span
                className="font-fs-mono text-[10.5px] text-fs-red truncate max-w-[20rem]"
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
                  className={cn(TAG, "border-fs-ink/45 text-fs-ink3")}
                  title={trace?.generator?.prompt ? "Resolved prompt captured" : "Connected input captured"}
                >
                  D
                </span>
              );
            })()}
            {node.stateSnapshots && node.stateSnapshots.length > 0 && (
              <span
                className={cn(TAG, "border-fs-ink/45 text-fs-ink3")}
                title={`${node.stateSnapshots.length} state snapshot${node.stateSnapshots.length === 1 ? "" : "s"}`}
              >
                S
              </span>
            )}
            {isDebugMode && node.blockInstanceId && (
              <span className="min-w-0 flex-1 truncate font-fs-mono text-[10.5px] font-medium text-fs-ink4">
                {node.blockInstanceId.slice(0, 8)}
              </span>
            )}
          </div>
          <span
            className={cn(
              "pr-3 text-right font-fs-mono text-[11px] font-medium tabular-nums",
              node.blockStatus === "failed" ? "text-fs-red" : "text-fs-ink3",
            )}
          >
            {node.blockDuration !== undefined ? formatMs(node.blockDuration) : ""}
          </span>
          <TimelineBar node={node} depth={depth} timeline={timeline} />
        </div>
        <BlockIOPreview node={node} depth={depth} />
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
              timeline={timeline}
            />
          ))}
      </div>
    );
  }

  if (node.type === "divider" && node.item) {
    return <TraceDividerView item={node.item} depth={depth} />;
  }

  if (node.type === "item" && node.item) {
    const item = node.item;
    const isSelected = selectedItemId === item.id;
    const preview = getItemPreview(item);

    return (
      <button
        className={cn(
          ROW_GRID,
          "min-h-6 w-full text-left hover:bg-fs-ink/5",
          isSelected && "bg-fs-blue/8 shadow-[inset_2px_0_0_var(--fs-blue)]",
        )}
        onClick={() => selectItem(item.id, item)}
      >
        <span className="flex min-w-0 items-center gap-1.5 self-stretch">
          <IndentGuides depth={depth} />
          <Minus className="h-2.5 w-3.5 shrink-0 text-fs-ink5" />
          <span className="font-fs-mono text-[11px] text-fs-ink3 truncate flex-1">{preview}</span>
          <span className="font-fs-mono text-[10px] text-fs-ink4 shrink-0">{item.type}</span>
        </span>
        <span />
        <span />
      </button>
    );
  }

  return null;
}

/**
 * Boundary marker for a `continuation` or `suspension_resume` item (FIX-865).
 * Separates the prior durable log (rendered above, via `rawItems` so retained
 * partial rows survive) from the live re-run that followed a crash-recovery
 * `/continue` or a resolved HITL suspension. Not "N items replayed" —
 * `priorItemCount` deliberately counts prior log rows, which can include
 * non-replayed partial rows (see `ContinuationItem`'s doc comment).
 */
function TraceDividerView({ item, depth }: { item: DevtoolItem; depth: number }) {
  const label =
    item.type === "continuation"
      ? `continued here — ${item.priorItemCount} prior item${item.priorItemCount === 1 ? "" : "s"}`
      : item.type === "suspension_resume"
        ? `resumed — ${item.resolution}`
        : "";

  return (
    <div
      className="flex items-center gap-2 py-1.5 pr-[18px]"
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <div className="h-px flex-1 bg-fs-ink/20" />
      <span className="shrink-0 font-fs-mono text-[10px] font-medium uppercase tracking-[.12em] text-fs-ink3">
        {label}
      </span>
      <div className="h-px flex-1 bg-fs-ink/20" />
    </div>
  );
}

/** Visual marker for blocks dispatched onto a side chain. */
function SideChainBadge() {
  return (
    <span
      className={cn(TAG, "border-dashed border-fs-ink/45 text-fs-ink3")}
      title="Side chain — dispatched via .sideChain() / .sideChainIf() / .forEachSideChain()"
    >
      SC
    </span>
  );
}

/**
 * Compact, single-line input→output summary rendered under a block row, so
 * per-iteration I/O is visible without selecting each block (FIX-643). Refs are
 * resolved through the trace lookup; values are truncated, with the full text
 * on hover. Renders nothing when the block has neither input nor output.
 */
function BlockIOPreview({ node, depth }: { node: TraceNode; depth: number }) {
  const { getItem } = useTraceLookup();
  const trace = node.traceItem?.type === "block_trace" ? (node.traceItem as BlockTraceItem) : undefined;

  const preview = useMemo(() => {
    if (!trace) return undefined;
    // Empty/whitespace-only values normalise to undefined so the row doesn't
    // render a dangling `in`/`out` label with no text.
    const input = trace.input?.source !== undefined
      ? compactValuePreview(trace.input.source, getItem) || undefined
      : undefined;
    const output = trace.output !== undefined
      ? compactValuePreview(trace.output, getItem) || undefined
      : undefined;
    if (input === undefined && output === undefined) return undefined;
    return { input, output };
  }, [trace, getItem]);

  if (!preview) return null;

  return (
    <div
      className="-mt-1 flex items-center gap-3 pb-1 pr-[18px] font-fs-mono text-[10.5px] text-fs-ink4 truncate"
      // Aligns under the block name: row padding + indent + chevron, glyph, kind columns and gaps.
      style={{ paddingLeft: `${depth * 16 + 76}px` }}
    >
      {preview.input !== undefined && (
        <span className="truncate" title={preview.input}>
          <span className="text-fs-ink3">in</span> {preview.input}
        </span>
      )}
      {preview.output !== undefined && (
        <span className="truncate" title={preview.output}>
          <span className="text-fs-ink3">out</span> {preview.output}
        </span>
      )}
    </div>
  );
}

/** Resolves a BlockValue to a short, single-line string for inline previews. */
function compactValuePreview(
  value: unknown,
  getItem: (id: string) => DevtoolItem | undefined
): string {
  const resolved = isInternalBlockValue(value)
    ? resolveBlockValueInternal(value, getItem as ItemLookup)
    : value;
  // A value the block never produced reads as absent, not as the word "undefined".
  if (resolved === undefined) return "";
  let text: string;
  if (typeof resolved === "string") {
    text = resolved;
  } else {
    try {
      text = JSON.stringify(resolved) ?? String(resolved);
    } catch {
      text = String(resolved);
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
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
      // arrive with an empty `message` and only a side-chain count.
      // Synthesize a label so the trace row isn't blank. See also
      // `StatusItemView` in components/items/status-item.tsx — same contract,
      // and the same dual-read for pre-FIX-766 persisted rows.
      if (item.message) return item.message;
      const pending = sideChainTaskCount(item);
      if (pending !== undefined) return sideChainTaskLabel(pending);
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
