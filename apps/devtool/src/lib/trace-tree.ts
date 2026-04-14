import type { BlockDebugItem, BlockOutputItem, OutputItem, SequencerStateSnapshotItem } from "@flow-state-dev/core/items";
import type { RequestGroup } from "@/components/workspace/stream-view";

/** A single snapshot in a sequencer's state timeline. */
export type StateSnapshot = {
  stepName: string;
  stepIndex: number;
  state: unknown;
  version: number;
  ts: number;
};

export type TraceNode = {
  type: "request" | "block" | "item";
  id: string;
  requestId?: string;
  action?: string;
  status?: string;
  duration?: number;
  blockName?: string;
  blockKind?: string;
  blockInstanceId?: string;
  blockStatus?: string;
  blockDuration?: number;
  blockStartedAt?: number;
  blockCompletedAt?: number;
  item?: OutputItem;
  /** The lifecycle trace item for this block (used for detail panel on click). */
  traceItem?: OutputItem;
  /** State snapshots for sequencer blocks, ordered by step execution. */
  stateSnapshots?: StateSnapshot[];
  children: TraceNode[];
  isExpanded: boolean;
};

export function buildTraceTree(requestGroups: RequestGroup[]): TraceNode[] {
  return requestGroups.map((group, groupIndex) => {
    const isLast = groupIndex === requestGroups.length - 1;
    const blockMap = new Map<string, TraceNode>();
    /** Tracks the parentBlockInstanceId for each block, collected during item iteration. */
    const parentOf = new Map<string, string>();
    const rootBlocks: TraceNode[] = [];
    const orphanItems: TraceNode[] = [];

    for (const item of group.items) {
      const prov = item.provenance;
      if (!prov) {
        orphanItems.push({
          type: "item",
          id: item.id,
          item,
          children: [],
          isExpanded: false,
        });
        continue;
      }

      let blockNode = blockMap.get(prov.blockInstanceId);
      if (!blockNode) {
        blockNode = {
          type: "block",
          id: `block-${prov.blockInstanceId}`,
          blockName: prov.blockName,
          blockKind: undefined,
          blockInstanceId: prov.blockInstanceId,
          blockStatus: "in_progress",
          children: [],
          isExpanded: isLast,
        };
        blockMap.set(prov.blockInstanceId, blockNode);
      }

      // Track parent relationship from provenance so the nesting phase can
      // use it directly instead of re-scanning the items array.
      if (prov.parentBlockInstanceId && !parentOf.has(prov.blockInstanceId)) {
        parentOf.set(prov.blockInstanceId, prov.parentBlockInstanceId);
      }

      // Block debug items provide early kind inference. They render as T3
      // debug-only children (controlled by debug mode in item-renderer).
      if (item.type === "block_debug") {
        const dbg = item as BlockDebugItem;
        blockNode.blockKind = blockNode.blockKind ?? dbg.blockKind;
      }

      // Collect sequencer state snapshots into the block node.
      if (item.type === "sequencer_state_snapshot") {
        const snap = item as SequencerStateSnapshotItem;
        if (!blockNode.stateSnapshots) blockNode.stateSnapshots = [];
        blockNode.stateSnapshots.push({
          stepName: snap.stepName,
          stepIndex: snap.stepIndex,
          state: snap.state,
          version: snap.version,
          ts: snap.ts,
        });
        // State snapshots are trace-only metadata — don't add as visible children.
        continue;
      }

      // Extract metadata from block_output items into the block node header.
      if (item.type === "block_output") {
        const bo = item as BlockOutputItem;
        blockNode.blockKind = blockNode.blockKind ?? bo.blockKind ?? inferBlockKind(item);
        if (bo.startedAt !== undefined) {
          blockNode.blockStartedAt = bo.startedAt;
        }
        if (bo.completedAt !== undefined) {
          blockNode.blockCompletedAt = bo.completedAt;
        }
        if (bo.duration !== undefined) {
          blockNode.blockDuration = bo.duration;
        }
        if (item.status === "completed") blockNode.blockStatus = "completed";
        if (item.status === "failed") blockNode.blockStatus = "failed";
        // Trace block_output items are lifecycle metadata already reflected
        // in the block node header — don't add as visible children.
        // Store as traceItem so block nodes can be selected for detail view.
        if (item.trace) {
          // Two trace sources emit for the same block: executeBlock (has output)
          // and emitNestedBlockTrace (output: undefined). Keep whichever has output.
          if (!blockNode.traceItem || bo.output !== undefined) {
            blockNode.traceItem = item;
          }
          continue;
        }
      }
      if (item.type === "block_tool_output") {
        blockNode.blockKind = blockNode.blockKind ?? "generator";
      }
      if (item.type === "router_decision") {
        blockNode.blockKind = blockNode.blockKind ?? "router";
      }
      if (item.type === "error") blockNode.blockStatus = "failed";

      blockNode.children.push({
        type: "item",
        id: item.id,
        item,
        children: [],
        isExpanded: false,
      });
    }

    for (const [instanceId, blockNode] of blockMap) {
      const parentId = parentOf.get(instanceId);

      if (parentId && parentId !== instanceId && blockMap.has(parentId)) {
        const parent = blockMap.get(parentId)!;
        const insertIndex = parent.children.findIndex((c) => c.type === "item");
        if (insertIndex >= 0) {
          parent.children.splice(insertIndex, 0, blockNode);
        } else {
          parent.children.push(blockNode);
        }
      } else {
        rootBlocks.push(blockNode);
      }
    }

    // Fall back to timestamp-based duration when lifecycle metadata is not available.
    for (const blockNode of blockMap.values()) {
      if (blockNode.blockDuration !== undefined) {
        continue;
      }
      const blockItems = group.items.filter(
        (i) => i.provenance?.blockInstanceId === blockNode.blockInstanceId,
      );
      const blockTs = blockItems.map((i) => i.ts).filter(Boolean);
      if (blockTs.length >= 2) {
        blockNode.blockDuration = Math.max(...blockTs) - Math.min(...blockTs);
      }
    }

    // Propagate status to blocks that never received a block_output trace item.
    // If the request is completed/failed and a block still shows "in_progress",
    // infer its status from its children or the request.
    if (group.status === "completed" || group.status === "failed") {
      for (const blockNode of blockMap.values()) {
        if (blockNode.blockStatus === "in_progress") {
          blockNode.blockStatus = inferBlockStatus(blockNode, group.status);
        }
      }
    }

    return {
      type: "request" as const,
      id: `req-${group.requestId}`,
      requestId: group.requestId,
      action: group.action,
      status: group.status,
      duration: group.duration,
      children: [...rootBlocks, ...orphanItems],
      isExpanded: isLast,
    };
  });
}

function inferBlockKind(item: OutputItem): string | undefined {
  if (item.type === "block_output" && (item as BlockOutputItem).toolCall) return "generator";
  return undefined;
}

function inferBlockStatus(node: TraceNode, requestStatus: string): string {
  const childBlocks = node.children.filter((c) => c.type === "block");
  if (childBlocks.length > 0) {
    const anyFailed = childBlocks.some((c) => c.blockStatus === "failed");
    if (anyFailed) return "failed";
    const allDone = childBlocks.every(
      (c) => c.blockStatus === "completed" || c.blockStatus === "failed",
    );
    if (allDone) return "completed";
  }
  return requestStatus;
}
